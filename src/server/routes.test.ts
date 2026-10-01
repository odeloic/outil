import { describe, expect, it } from "vitest";
import type { ActivityEvent, AgentModel, AgentStatus, Review, ReviewTarget } from "../shared/api.ts";
import type { EventHandlers } from "./events.ts";
import { RefError } from "./errors.ts";
import { ReviewError } from "./reviews.ts";
import { createRoutes, type RouteDeps } from "./routes.ts";

function makeApp(overrides: Partial<RouteDeps>) {
  const unstubbed = async (): Promise<never> => {
    throw new Error("not stubbed");
  };
  return createRoutes({
    repoInfo: async () => ({ root: "/repo", head: null, reviewer: null }),
    resolveCommit: unstubbed,
    getCommit: unstubbed,
    listChanges: unstubbed,
    getFileDiff: unstubbed,
    listCommits: unstubbed,
    compareCommits: unstubbed,
    getReview: unstubbed,
    createThread: unstubbed,
    editDraft: unstubbed,
    deleteDraft: unstubbed,
    addFollowUp: unstubbed,
    resolveThread: unstubbed,
    detectAgents: unstubbed,
    listModels: unstubbed,
    send: unstubbed,
    cancelRun: unstubbed,
    markThreadRead: unstubbed,
    subscribeEvents: () => {
      throw new Error("not stubbed");
    },
    ...overrides,
  });
}

async function readEvents(body: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: string[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (chunk.trim() !== "") events.push(chunk);
    }
  }
  await reader.cancel();
  return events;
}

describe("GET /api/resolve", () => {
  it("resolves HEAD when no ref is given", async () => {
    const app = makeApp({ resolveCommit: async (ref) => `sha-of-${ref}` });

    const res = await app.request("/api/resolve");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ref: "HEAD", sha: "sha-of-HEAD" });
  });

  it("passes the ref through untouched", async () => {
    const app = makeApp({ resolveCommit: async (ref) => `sha-of-${ref}` });

    const res = await app.request(`/api/resolve?ref=${encodeURIComponent("feature/x~2")}`);
    expect(await res.json()).toEqual({ ref: "feature/x~2", sha: "sha-of-feature/x~2" });
  });

  it("reports ref errors as a 400 with their code", async () => {
    const app = makeApp({
      resolveCommit: async () => {
        throw new RefError("not-a-commit", "points to a tree");
      },
    });

    const res = await app.request("/api/resolve?ref=HEAD^{tree}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "points to a tree", code: "not-a-commit" });
  });

  it("reports unexpected failures as a 500", async () => {
    const app = makeApp({
      resolveCommit: async () => {
        throw new Error("git not found");
      },
    });

    const res = await app.request("/api/resolve?ref=HEAD");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "git not found" });
  });
});

describe("GET /api/commit", () => {
  const details = {
    sha: "a".repeat(40),
    parents: ["b".repeat(40)],
    author: { name: "Ada", email: "ada@example.com" },
    date: "2026-09-30T12:00:00+02:00",
    subject: "Add things",
    body: "Line one\nLine two",
  };

  it("resolves the ref and returns the commit's details", async () => {
    const app = makeApp({
      resolveCommit: async (ref) => (ref === "main" ? details.sha : "wrong"),
      getCommit: async (sha) => ({ ...details, sha }),
    });

    const res = await app.request("/api/commit?ref=main");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(details);
  });

  it("reports ref errors as a 400 with their code", async () => {
    const app = makeApp({
      resolveCommit: async () => {
        throw new RefError("unknown", "no such ref");
      },
    });

    const res = await app.request("/api/commit?ref=nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no such ref", code: "unknown" });
  });
});

describe("GET /api/changes", () => {
  const head = "a".repeat(40);
  const base = "b".repeat(40);

  it("lists changes between base and head, or from nothing when base is absent", async () => {
    const calls: [string | null, string][] = [];
    const app = makeApp({
      listChanges: async (from, to) => {
        calls.push([from, to]);
        return { base: from, head: to, files: [], additions: 0, deletions: 0 };
      },
    });

    expect((await app.request(`/api/changes?base=${base}&head=${head}`)).status).toBe(200);
    expect((await app.request(`/api/changes?head=${head}`)).status).toBe(200);
    expect(calls).toEqual([[base, head], [null, head]]);
  });

  it("rejects anything that is not a full commit id", async () => {
    const app = makeApp({});

    for (const query of ["", `head=main`, `head=${head}&base=HEAD~1`, `head=--all`, `head=${head.slice(0, 7)}`]) {
      const res = await app.request(`/api/changes?${query}`);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/file-diff", () => {
  const head = "a".repeat(40);
  const base = "b".repeat(40);

  it("passes base, head, path, oldPath, and full through to getFileDiff", async () => {
    const calls: Array<{ base: string | null; head: string; path: string; oldPath: string | null; full: boolean }> = [];
    const app = makeApp({
      getFileDiff: async (request) => {
        calls.push(request);
        return { kind: "binary" };
      },
    });

    const res = await app.request(
      `/api/file-diff?base=${base}&head=${head}&path=${encodeURIComponent("src/a.ts")}&oldPath=${encodeURIComponent("src/old.ts")}&full=1`,
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ base, head, path: "src/a.ts", oldPath: "src/old.ts", full: true }]);
  });

  it('passes full only when the query value is exactly "1"', async () => {
    const calls: boolean[] = [];
    const app = makeApp({
      getFileDiff: async ({ full }) => {
        calls.push(full);
        return { kind: "binary" };
      },
    });

    for (const full of ["0", "true", "01", "", undefined]) {
      const query = full === undefined ? "" : `&full=${full}`;
      await app.request(`/api/file-diff?head=${head}&path=file.txt${query}`);
    }
    expect(calls).toEqual([false, false, false, false, false]);
  });

  it("treats base as absent when it is not given", async () => {
    const calls: Array<string | null> = [];
    const app = makeApp({
      getFileDiff: async ({ base }) => {
        calls.push(base);
        return { kind: "binary" };
      },
    });

    await app.request(`/api/file-diff?head=${head}&path=file.txt`);
    expect(calls).toEqual([null]);
  });

  it("rejects a missing, empty, or multi-line path with a 400", async () => {
    const app = makeApp({});

    for (const query of [`head=${head}`, `head=${head}&path=`, `head=${head}&path=a%0Ab`, `head=${head}&path=a&oldPath=b%0Ac`]) {
      const res = await app.request(`/api/file-diff?${query}`);
      expect(res.status).toBe(400);
    }
  });

  it("rejects a head or base that is not a full commit id", async () => {
    const app = makeApp({});

    for (const query of [
      `head=main&path=file.txt`,
      `head=${head.slice(0, 7)}&path=file.txt`,
      `head=${head}&base=HEAD~1&path=file.txt`,
      `head=${head}&base=${base.slice(0, 7)}&path=file.txt`,
    ]) {
      const res = await app.request(`/api/file-diff?${query}`);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/history", () => {
  it("passes paging and filters through with defaults", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      listCommits: async (query) => {
        calls.push(query);
        return { commits: [], hasMore: false };
      },
    });

    expect((await app.request("/api/history")).status).toBe(200);
    expect((await app.request("/api/history?skip=50&limit=20&message=%20fix%20&author=ada")).status).toBe(200);
    expect((await app.request("/api/history?limit=100000")).status).toBe(200);
    expect(calls).toEqual([
      { skip: 0, limit: 50, message: "", author: "" },
      { skip: 50, limit: 20, message: "fix", author: "ada" },
      { skip: 0, limit: 200, message: "", author: "" },
    ]);
  });

  it("rejects paging values that are not whole numbers", async () => {
    const app = makeApp({});

    for (const query of ["skip=-1", "limit=abc", "skip=1.5", "limit="]) {
      expect((await app.request(`/api/history?${query}`)).status).toBe(400);
    }
  });
});

describe("GET /api/compare", () => {
  it("pins both references before comparing them", async () => {
    const calls: string[][] = [];
    const app = makeApp({
      resolveCommit: async (ref) => `sha-of-${ref}`,
      compareCommits: async (base, head) => {
        calls.push([base, head]);
        return {} as never;
      },
    });

    expect((await app.request("/api/compare?base=main&head=feature/x")).status).toBe(200);
    expect(calls).toEqual([["sha-of-main", "sha-of-feature/x"]]);
  });

  it("reports an unknown reference as a 400 and a missing one as a 400", async () => {
    const app = makeApp({
      resolveCommit: async (ref) => {
        if (ref === "nope") throw new RefError("unknown", "no such ref");
        return ref;
      },
    });

    const unknown = await app.request("/api/compare?base=nope&head=main");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "no such ref", code: "unknown" });
    expect((await app.request("/api/compare?base=main")).status).toBe(400);
  });
});

const sha = "a".repeat(40);
const sha2 = "b".repeat(40);

const emptyReview = (target: ReviewTarget): Review => ({
  key: sha,
  target,
  base: null,
  head: sha,
  threads: [],
  runs: [],
  nextThread: 1,
  revision: 0,
  generation: "g1",
});

describe("GET /api/review", () => {
  it("resolves a commit target", async () => {
    const calls: ReviewTarget[] = [];
    const app = makeApp({
      getReview: async (target) => {
        calls.push(target);
        return emptyReview(target);
      },
    });

    const res = await app.request(`/api/review?commit=${sha}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ kind: "commit", sha }]);
  });

  it("resolves a base/head compare target", async () => {
    const calls: ReviewTarget[] = [];
    const app = makeApp({
      getReview: async (target) => {
        calls.push(target);
        return emptyReview(target);
      },
    });

    const res = await app.request(`/api/review?base=${sha}&head=${sha2}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ kind: "compare", base: sha, head: sha2 }]);
  });

  it("rejects a query that is neither a commit nor a full base/head pair", async () => {
    const app = makeApp({});

    for (const query of ["", `commit=${sha.slice(0, 7)}`, `base=${sha}`, `base=HEAD&head=${sha2}`]) {
      expect((await app.request(`/api/review?${query}`)).status).toBe(400);
    }
  });

  it("reports a ref error as a 400", async () => {
    const app = makeApp({
      getReview: async () => {
        throw new RefError("unknown", "no such commit");
      },
    });

    const res = await app.request(`/api/review?commit=${sha}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no such commit", code: "unknown" });
  });
});

describe("POST /api/review/threads", () => {
  const target: ReviewTarget = { kind: "commit", sha };
  const anchor = { path: "src/a.ts", side: "new" as const, startLine: 3, endLine: 5 };

  it("creates a thread with the given anchor and body", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      createThread: async (t, a, body) => {
        calls.push([t, a, body]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, anchor, body: "  Please fix this.  " }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, anchor, "Please fix this."]]);
  });

  it("rejects an invalid target, anchor, or body", async () => {
    const app = makeApp({});
    const cases = [
      { target: { kind: "commit", sha: "short" }, anchor, body: "x" },
      { target, anchor: { ...anchor, path: "" }, body: "x" },
      { target, anchor: { ...anchor, path: "a\nb" }, body: "x" },
      { target, anchor: { ...anchor, side: "both" }, body: "x" },
      { target, anchor: { ...anchor, startLine: 0 }, body: "x" },
      { target, anchor: { ...anchor, startLine: 5, endLine: 3 }, body: "x" },
      { target, anchor, body: "   " },
      { target, anchor, body: "x".repeat(20001) },
    ];
    for (const json of cases) {
      const res = await app.request("/api/review/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("PATCH /api/review/messages/:id", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("edits a draft message's body", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      editDraft: async (t, id, body) => {
        calls.push([t, id, body]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/messages/m1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "updated" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "m1", "updated"]]);
  });

  it("returns 404 for an unknown message id", async () => {
    const app = makeApp({
      editDraft: async () => {
        throw new ReviewError(404, "No message with id m1.");
      },
    });

    const res = await app.request("/api/review/messages/m1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "updated" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the message is not a reviewer draft", async () => {
    const app = makeApp({
      editDraft: async () => {
        throw new ReviewError(409, "Only a draft reviewer message can be edited or deleted.");
      },
    });

    const res = await app.request("/api/review/messages/m1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "updated" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects an empty or missing body", async () => {
    const app = makeApp({});

    for (const json of [{ target }, { target, body: "" }, { target, body: "   " }]) {
      const res = await app.request("/api/review/messages/m1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("DELETE /api/review/messages/:id", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("deletes a draft message", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      deleteDraft: async (t, id) => {
        calls.push([t, id]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/messages/m1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "m1"]]);
  });

  it("returns 404 for an unknown message id and 409 for a non-draft message", async () => {
    const notFound = makeApp({
      deleteDraft: async () => {
        throw new ReviewError(404, "No message with id m1.");
      },
    });
    const notDraft = makeApp({
      deleteDraft: async () => {
        throw new ReviewError(409, "Only a draft reviewer message can be edited or deleted.");
      },
    });

    const body = JSON.stringify({ target });
    const headers = { "content-type": "application/json" };
    expect((await notFound.request("/api/review/messages/m1", { method: "DELETE", headers, body })).status).toBe(404);
    expect((await notDraft.request("/api/review/messages/m1", { method: "DELETE", headers, body })).status).toBe(409);
  });

  it("rejects a request without a valid target", async () => {
    const app = makeApp({});

    const res = await app.request("/api/review/messages/m1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/review/threads/:id/messages", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("appends a follow-up draft to the thread and returns the updated review", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      addFollowUp: async (t, id, body) => {
        calls.push([t, id, body]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/threads/t1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "  as in my other comment…  " }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "t1", "as in my other comment…"]]);
  });

  it("returns 404 for an unknown thread id", async () => {
    const app = makeApp({
      addFollowUp: async () => {
        throw new ReviewError(404, "No thread with id t1.");
      },
    });

    const res = await app.request("/api/review/threads/t1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the thread is not waiting on the reviewer", async () => {
    const app = makeApp({
      addFollowUp: async () => {
        throw new ReviewError(409, "This thread already has a pending draft.");
      },
    });

    const res = await app.request("/api/review/threads/t1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, body: "x" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects an empty or missing body", async () => {
    const app = makeApp({});

    for (const json of [{ target }, { target, body: "" }, { target, body: "   " }]) {
      const res = await app.request("/api/review/threads/t1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("POST /api/review/threads/:id/resolve", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("resolves the thread and returns the updated review", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      resolveThread: async (t, id, resolved) => {
        calls.push([t, id, resolved]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/threads/t1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, resolved: true }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "t1", true]]);
  });

  it("reopens the thread when resolved is false", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      resolveThread: async (t, id, resolved) => {
        calls.push([t, id, resolved]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/threads/t1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, resolved: false }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "t1", false]]);
  });

  it("returns 404 for an unknown thread id", async () => {
    const app = makeApp({
      resolveThread: async () => {
        throw new ReviewError(404, "No thread with id t1.");
      },
    });

    const res = await app.request("/api/review/threads/t1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, resolved: true }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the thread is part of a run in progress", async () => {
    const app = makeApp({
      resolveThread: async () => {
        throw new ReviewError(409, "This thread is part of a run in progress.");
      },
    });

    const res = await app.request("/api/review/threads/t1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, resolved: true }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a request without a valid target or resolved flag", async () => {
    const app = makeApp({});

    for (const json of [{ resolved: true }, { target, resolved: "yes" }, { target }]) {
      const res = await app.request("/api/review/threads/t1/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/agents", () => {
  const agents: AgentStatus[] = [{ id: "claude", name: "Claude Code", state: "ready", fix: null }];

  it("returns the detection result", async () => {
    const app = makeApp({ detectAgents: async () => agents });

    const res = await app.request("/api/agents");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(agents);
  });

  it("passes refresh=1 through as true, and its absence as false", async () => {
    const calls: boolean[] = [];
    const app = makeApp({
      detectAgents: async (refresh) => {
        calls.push(refresh);
        return agents;
      },
    });

    await app.request("/api/agents");
    await app.request("/api/agents?refresh=1");
    expect(calls).toEqual([false, true]);
  });

  it("reports detection failures as a 500", async () => {
    const app = makeApp({
      detectAgents: async () => {
        throw new Error("detection failed");
      },
    });

    const res = await app.request("/api/agents");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "detection failed" });
  });
});

describe("POST /api/review/send", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("sends the target, agent, and model through and returns the updated review", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      send: async (t, agent, model) => {
        calls.push([t, agent, model]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "claude", "haiku"]]);
  });

  it("rejects an invalid target, agent, or model", async () => {
    const app = makeApp({});
    const cases = [
      { target: { kind: "commit", sha: "short" }, agent: "claude", model: "haiku" },
      { target, agent: "gemini", model: "haiku" },
      { target, agent: "claude", model: "" },
      { target, agent: "claude", model: "   " },
      { target, agent: "claude" },
      { target, model: "haiku" },
    ];
    for (const json of cases) {
      const res = await app.request("/api/review/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      expect(res.status).toBe(400);
    }
  });

  it("maps a 409 ReviewError (agent not ready, or a run in progress) through", async () => {
    const app = makeApp({
      send: async () => {
        throw new ReviewError(409, "claude is not ready to run.");
      },
    });

    const res = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(res.status).toBe(409);
  });

  it("includes the agent's fix text in a 409 for a not-ready agent", async () => {
    const app = makeApp({
      send: async () => {
        throw new ReviewError(409, "Claude Code is not ready to run. Check the Agents panel.", "Run `claude auth login`.");
      },
    });

    const res = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Claude Code is not ready to run. Check the Agents panel.",
      fix: "Run `claude auth login`.",
    });
  });

  it("omits fix when a 409 ReviewError carries none", async () => {
    const app = makeApp({
      send: async () => {
        throw new ReviewError(409, "A run is already in progress for this review.");
      },
    });

    const res = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(await res.json()).toEqual({ error: "A run is already in progress for this review." });
  });

  it("maps a 400 ReviewError (nothing to send) through", async () => {
    const app = makeApp({
      send: async () => {
        throw new ReviewError(400, "There is nothing to send.");
      },
    });

    const res = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/review/runs/:id/cancel", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("cancels the run and returns the updated review", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      cancelRun: async (t, id) => {
        calls.push([t, id]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/runs/r1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "r1"]]);
  });

  it("rejects a request with no target", async () => {
    const app = makeApp({});

    const res = await app.request("/api/review/runs/r1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown run id", async () => {
    const app = makeApp({
      cancelRun: async () => {
        throw new ReviewError(404, "No run with id r1.");
      },
    });

    const res = await app.request("/api/review/runs/r1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the run is not in progress", async () => {
    const app = makeApp({
      cancelRun: async () => {
        throw new ReviewError(409, "This run is not in progress.");
      },
    });

    const res = await app.request("/api/review/runs/r1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/review/threads/:id/read", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("marks the thread's agent messages read", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      markThreadRead: async (t, id) => {
        calls.push([t, id]);
        return emptyReview(t);
      },
    });

    const res = await app.request("/api/review/threads/t1/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([[target, "t1"]]);
  });

  it("returns 404 for an unknown thread id", async () => {
    const app = makeApp({
      markThreadRead: async () => {
        throw new ReviewError(404, "No thread with id t1.");
      },
    });

    const res = await app.request("/api/review/threads/t1/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a request without a valid target", async () => {
    const app = makeApp({});

    const res = await app.request("/api/review/threads/t1/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agents/:id/models", () => {
  const ready: AgentStatus[] = [
    { id: "claude", name: "Claude Code", state: "ready", fix: null },
    { id: "codex", name: "Codex", state: "signed-out", fix: "Run `codex login`." },
  ];
  const models: AgentModel[] = [{ id: "opus", label: "Opus" }];

  it("rejects an id other than claude or codex", async () => {
    const app = makeApp({});

    const res = await app.request("/api/agents/gemini/models");
    expect(res.status).toBe(400);
  });

  it("returns the models for a ready agent", async () => {
    let calls = 0;
    const app = makeApp({
      detectAgents: async () => ready,
      listModels: async (agent) => {
        calls++;
        expect(agent).toBe("claude");
        return models;
      },
    });

    const res = await app.request("/api/agents/claude/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(models);
    expect(calls).toBe(1);
  });

  it("caches the models for an agent across requests", async () => {
    let calls = 0;
    const app = makeApp({
      detectAgents: async () => ready,
      listModels: async () => {
        calls++;
        return models;
      },
    });

    await app.request("/api/agents/claude/models");
    await app.request("/api/agents/claude/models");
    expect(calls).toBe(1);
  });

  it("returns 409 when the agent is not ready", async () => {
    const app = makeApp({ detectAgents: async () => ready, listModels: unstubbedListModels });

    const res = await app.request("/api/agents/codex/models");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Codex is not ready." });
  });

  it("reports listModels failures as a 500 and retries on the next call", async () => {
    let calls = 0;
    const app = makeApp({
      detectAgents: async () => ready,
      listModels: async () => {
        calls++;
        if (calls === 1) throw new Error("codex debug models failed");
        return models;
      },
    });

    const failed = await app.request("/api/agents/claude/models");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "codex debug models failed" });

    const ok = await app.request("/api/agents/claude/models");
    expect(ok.status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe("GET /api/review/events", () => {
  const target: ReviewTarget = { kind: "commit", sha };

  it("sends the current review, then replays buffered activity, on connect", async () => {
    const activity: ActivityEvent = { runId: "r1", seq: 1, text: "Reading a.ts", at: "d" };
    const subscriptions: EventHandlers[] = [];
    const app = makeApp({
      getReview: async (t) => emptyReview(t),
      subscribeEvents: (key, handlers) => {
        expect(key).toBe(sha);
        subscriptions.push(handlers);
        return { activity: [activity], unsubscribe: () => {} };
      },
    });

    const res = await app.request(`/api/review/events?commit=${sha}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res.body!, 2);
    expect(events[0]).toContain("event: review");
    expect(events[0]).toContain(JSON.stringify(emptyReview(target)));
    expect(events[1]).toContain("event: activity");
    expect(events[1]).toContain(JSON.stringify(activity));
  });

  it("subscribes before fetching the review to serve, so an update landing in between is not lost", async () => {
    let handlers: EventHandlers | undefined;
    const app = makeApp({
      getReview: async (t) => emptyReview(t),
      subscribeEvents: (_key, h) => {
        handlers = h;
        queueMicrotask(() => handlers!.onReview({ ...emptyReview(target), revision: 7 }));
        return { activity: [], unsubscribe: () => {} };
      },
    });

    const res = await app.request(`/api/review/events?commit=${sha}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"revision":7')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('"revision":7');
    await reader.cancel();
  });

  it("streams a later review and activity event as they are published", async () => {
    let handlers: EventHandlers | undefined;
    const app = makeApp({
      getReview: async (t) => emptyReview(t),
      subscribeEvents: (_key, h) => {
        handlers = h;
        return { activity: [], unsubscribe: () => {} };
      },
    });

    const res = await app.request(`/api/review/events?commit=${sha}`);
    const reader = res.body!.getReader();
    await reader.read();

    const updated = { ...emptyReview(target), revision: 1 };
    handlers!.onReview(updated);
    const activity: ActivityEvent = { runId: "r1", seq: 1, text: "Thinking", at: "d" };
    handlers!.onActivity(activity);

    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes(JSON.stringify(activity))) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain(JSON.stringify(updated));
    expect(text).toContain(JSON.stringify(activity));
    await reader.cancel();
  });

  it("unsubscribes once the client disconnects", async () => {
    let unsubscribed = false;
    const app = makeApp({
      getReview: async (t) => emptyReview(t),
      subscribeEvents: () => ({ activity: [], unsubscribe: () => (unsubscribed = true) }),
    });

    const res = await app.request(`/api/review/events?commit=${sha}`);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribed).toBe(true);
  });

  it("rejects a query that is neither a commit nor a full base/head pair", async () => {
    const app = makeApp({});

    const res = await app.request("/api/review/events");
    expect(res.status).toBe(400);
  });

  it("reports a ref error as a 400 instead of opening the stream", async () => {
    const app = makeApp({
      getReview: async () => {
        throw new RefError("unknown", "no such commit");
      },
    });

    const res = await app.request(`/api/review/events?commit=${sha}`);
    expect(res.status).toBe(400);
  });
});

async function unstubbedListModels(): Promise<AgentModel[]> {
  throw new Error("not stubbed");
}
