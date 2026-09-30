import { Hono } from "hono";
import { validator } from "hono/validator";
import type { ApiError, ChangeSet, CommitDetails, RepoInfo, ResolvedCommit } from "../shared/api.ts";
import { RefError } from "./errors.ts";

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
  resolveCommit: (ref: string) => Promise<string>;
  getCommit: (sha: string) => Promise<CommitDetails>;
  listChanges: (base: string | null, head: string) => Promise<ChangeSet>;
};

function toApiError(err: unknown): ApiError {
  if (err instanceof RefError) return { error: err.message, code: err.code };
  return { error: err instanceof Error ? err.message : String(err) };
}

const refQuery = validator("query", (query) => ({ ref: typeof query.ref === "string" ? query.ref : "HEAD" }));

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const rangeQuery = validator("query", (query, c): { base?: string; head: string } | Response => {
  const { base, head } = query;
  if (typeof head !== "string" || !OBJECT_ID.test(head) || (base !== undefined && (typeof base !== "string" || !OBJECT_ID.test(base)))) {
    return c.json({ error: "base and head must be full commit IDs." } satisfies ApiError, 400);
  }
  return typeof base === "string" ? { base, head } : { head };
});

function refFailure(err: unknown) {
  return [toApiError(err), err instanceof RefError ? 400 : 500] as const;
}

export function createRoutes({ repoInfo, resolveCommit, getCommit, listChanges }: RouteDeps) {
  return new Hono()
    .get("/api/repo", async (c) => {
      try {
        return c.json(await repoInfo(), 200);
      } catch (err) {
        return c.json(toApiError(err), 500);
      }
    })
    .get("/api/resolve", refQuery, async (c) => {
      const { ref } = c.req.valid("query");
      try {
        const body: ResolvedCommit = { ref, sha: await resolveCommit(ref) };
        return c.json(body, 200);
      } catch (err) {
        return c.json(...refFailure(err));
      }
    })
    .get("/api/commit", refQuery, async (c) => {
      const { ref } = c.req.valid("query");
      try {
        return c.json(await getCommit(await resolveCommit(ref)), 200);
      } catch (err) {
        return c.json(...refFailure(err));
      }
    })
    .get("/api/changes", rangeQuery, async (c) => {
      const { base, head } = c.req.valid("query");
      try {
        return c.json(await listChanges(base ?? null, head), 200);
      } catch (err) {
        return c.json(...refFailure(err));
      }
    });
}

export type AppType = ReturnType<typeof createRoutes>;
