import { describe, expect, it } from "vitest";
import { RefError } from "./errors.ts";
import { createRoutes, type RouteDeps } from "./routes.ts";

function makeApp(overrides: Partial<RouteDeps>) {
  const unstubbed = async (): Promise<never> => {
    throw new Error("not stubbed");
  };
  return createRoutes({
    repoInfo: async () => ({ root: "/repo", head: null }),
    resolveCommit: unstubbed,
    getCommit: unstubbed,
    listChanges: unstubbed,
    getFileDiff: unstubbed,
    listCommits: unstubbed,
    ...overrides,
  });
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
