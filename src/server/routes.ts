import { Hono } from "hono";
import { validator } from "hono/validator";
import type { ApiError, RepoInfo, ResolvedCommit } from "../shared/api.ts";
import { RefError } from "./errors.ts";

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
  resolveCommit: (ref: string) => Promise<string>;
};

function toApiError(err: unknown): ApiError {
  if (err instanceof RefError) return { error: err.message, code: err.code };
  return { error: err instanceof Error ? err.message : String(err) };
}

export function createRoutes({ repoInfo, resolveCommit }: RouteDeps) {
  return new Hono()
    .get("/api/repo", async (c) => {
      try {
        return c.json(await repoInfo(), 200);
      } catch (err) {
        return c.json(toApiError(err), 500);
      }
    })
    .get(
      "/api/resolve",
      validator("query", (query) => ({ ref: typeof query.ref === "string" ? query.ref : "HEAD" })),
      async (c) => {
        const { ref } = c.req.valid("query");
        try {
          const body: ResolvedCommit = { ref, sha: await resolveCommit(ref) };
          return c.json(body, 200);
        } catch (err) {
          return c.json(toApiError(err), err instanceof RefError ? 400 : 500);
        }
      },
    );
}

export type AppType = ReturnType<typeof createRoutes>;
