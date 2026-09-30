import { Hono } from "hono";
import { validator } from "hono/validator";
import type {
  ApiError,
  ChangeSet,
  CommitDetails,
  Comparison,
  FileDiff,
  FileDiffRequest,
  HistoryPage,
  HistoryQuery,
  RepoInfo,
  ResolvedCommit,
} from "../shared/api.ts";
import { RefError } from "./errors.ts";

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
  resolveCommit: (ref: string) => Promise<string>;
  getCommit: (sha: string) => Promise<CommitDetails>;
  listChanges: (base: string | null, head: string) => Promise<ChangeSet>;
  getFileDiff: (request: FileDiffRequest) => Promise<FileDiff>;
  listCommits: (query: HistoryQuery) => Promise<HistoryPage>;
  compareCommits: (base: string, head: string) => Promise<Comparison>;
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

export const MAX_HISTORY_PAGE = 200;

function count(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) return null;
  return Math.min(Number(value), max);
}

const historyQuery = validator(
  "query",
  (query, c): { skip?: string; limit?: string; message?: string; author?: string } | Response => {
    const { skip, limit, message, author } = query;
    const valid =
      count(skip, 0, Number.MAX_SAFE_INTEGER) !== null &&
      count(limit, 50, MAX_HISTORY_PAGE) !== null &&
      (message === undefined || typeof message === "string") &&
      (author === undefined || typeof author === "string");
    if (!valid) return c.json({ error: "Invalid history query." } satisfies ApiError, 400);
    return {
      ...(typeof skip === "string" ? { skip } : {}),
      ...(typeof limit === "string" ? { limit } : {}),
      ...(typeof message === "string" ? { message } : {}),
      ...(typeof author === "string" ? { author } : {}),
    };
  },
);

function refFailure(err: unknown) {
  return [toApiError(err), err instanceof RefError ? 400 : 500] as const;
}

export function createRoutes({
  repoInfo,
  resolveCommit,
  getCommit,
  listChanges,
  getFileDiff,
  listCommits,
  compareCommits,
}: RouteDeps) {
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
    })
    .get(
      "/api/compare",
      validator("query", (query, c): { base: string; head: string } | Response => {
        const { base, head } = query;
        if (typeof base !== "string" || typeof head !== "string") {
          return c.json({ error: "A comparison needs a base and a head reference." } satisfies ApiError, 400);
        }
        return { base, head };
      }),
      async (c) => {
        const { base, head } = c.req.valid("query");
        try {
          const [baseSha, headSha] = await Promise.all([resolveCommit(base), resolveCommit(head)]);
          return c.json(await compareCommits(baseSha, headSha), 200);
        } catch (err) {
          return c.json(...refFailure(err));
        }
      },
    )
    .get("/api/history", historyQuery, async (c) => {
      const query = c.req.valid("query");
      try {
        const page = await listCommits({
          skip: count(query.skip, 0, Number.MAX_SAFE_INTEGER) ?? 0,
          limit: Math.max(1, count(query.limit, 50, MAX_HISTORY_PAGE) ?? 50),
          message: query.message?.trim() ?? "",
          author: query.author?.trim() ?? "",
        });
        return c.json(page, 200);
      } catch (err) {
        return c.json(toApiError(err), 500);
      }
    });
}

export type AppType = ReturnType<typeof createRoutes>;
