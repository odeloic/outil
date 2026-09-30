import { Hono } from "hono";
import { validator } from "hono/validator";
import type { ApiError, ChangeSet, CommitDetails, FileDiff, FileDiffRequest, RepoInfo, ResolvedCommit } from "../shared/api.ts";
import { RefError } from "./errors.ts";

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
  resolveCommit: (ref: string) => Promise<string>;
  getCommit: (sha: string) => Promise<CommitDetails>;
  listChanges: (base: string | null, head: string) => Promise<ChangeSet>;
  getFileDiff: (request: FileDiffRequest) => Promise<FileDiff>;
};

function toApiError(err: unknown): ApiError {
  if (err instanceof RefError) return { error: err.message, code: err.code };
  return { error: err instanceof Error ? err.message : String(err) };
}

const refQuery = validator("query", (query) => ({ ref: typeof query.ref === "string" ? query.ref : "HEAD" }));

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type Range = { base?: string; head: string };

function parseRange(query: Record<string, string | string[]>): Range | null {
  const { base, head } = query;
  if (typeof head !== "string" || !OBJECT_ID.test(head)) return null;
  if (base === undefined) return { head };
  return typeof base === "string" && OBJECT_ID.test(base) ? { base, head } : null;
}

const rangeQuery = validator("query", (query, c): Range | Response => {
  return parseRange(query) ?? c.json({ error: "base and head must be full commit IDs." } satisfies ApiError, 400);
});

const fileQuery = validator("query", (query, c): (Range & { path: string; oldPath?: string; full?: string }) | Response => {
  const range = parseRange(query);
  const { path, oldPath, full } = query;
  const validPath = (p: unknown): p is string => typeof p === "string" && p !== "" && !p.includes("\n");
  if (!range || !validPath(path) || (oldPath !== undefined && !validPath(oldPath))) {
    return c.json({ error: "A file diff needs full commit IDs and a path." } satisfies ApiError, 400);
  }
  return { ...range, path, ...(oldPath ? { oldPath } : {}), ...(full === "1" ? { full } : {}) };
});

function refFailure(err: unknown) {
  return [toApiError(err), err instanceof RefError ? 400 : 500] as const;
}

export function createRoutes({ repoInfo, resolveCommit, getCommit, listChanges, getFileDiff }: RouteDeps) {
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
    })
    .get("/api/file-diff", fileQuery, async (c) => {
      const { base, head, path, oldPath, full } = c.req.valid("query");
      try {
        return c.json(await getFileDiff({ base: base ?? null, head, path, oldPath: oldPath ?? null, full: full === "1" }), 200);
      } catch (err) {
        return c.json(...refFailure(err));
      }
    });
}

export type AppType = ReturnType<typeof createRoutes>;
