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
