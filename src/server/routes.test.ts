import { describe, expect, it } from "vitest";
import { RefError } from "./errors.ts";
import { createRoutes } from "./routes.ts";

const repoInfo = async () => ({ root: "/repo", head: null });

describe("GET /api/resolve", () => {
  it("resolves HEAD when no ref is given", async () => {
    const app = createRoutes({ repoInfo, resolveCommit: async (ref) => `sha-of-${ref}` });

    const res = await app.request("/api/resolve");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ref: "HEAD", sha: "sha-of-HEAD" });
  });

  it("passes the ref through untouched", async () => {
    const app = createRoutes({ repoInfo, resolveCommit: async (ref) => `sha-of-${ref}` });

    const res = await app.request(`/api/resolve?ref=${encodeURIComponent("feature/x~2")}`);
    expect(await res.json()).toEqual({ ref: "feature/x~2", sha: "sha-of-feature/x~2" });
  });

  it("reports ref errors as a 400 with their code", async () => {
    const app = createRoutes({
      repoInfo,
      resolveCommit: async () => {
        throw new RefError("not-a-commit", "points to a tree");
      },
    });

    const res = await app.request("/api/resolve?ref=HEAD^{tree}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "points to a tree", code: "not-a-commit" });
  });

  it("reports unexpected failures as a 500", async () => {
    const app = createRoutes({
      repoInfo,
      resolveCommit: async () => {
        throw new Error("git not found");
      },
    });

    const res = await app.request("/api/resolve?ref=HEAD");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "git not found" });
  });
});
