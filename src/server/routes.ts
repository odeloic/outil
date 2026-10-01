import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import type {
  ActivityEvent,
  AgentId,
  AgentModel,
  AgentStatus,
  ApiError,
  ChangeSet,
  CommitDetails,
  Comparison,
  FileDiff,
  FileDiffRequest,
  HistoryPage,
  HistoryQuery,
  Review,
  ReviewTarget,
  RepoInfo,
  ResolvedCommit,
  ThreadAnchor,
} from "../shared/api.ts";
import { MODEL_PATTERN } from "../shared/agents.ts";
import type { EventHandlers, Subscription } from "./events.ts";
import { RefError } from "./errors.ts";
import { ReviewError } from "./reviews.ts";

const HEARTBEAT_MS = 15000;

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
  resolveCommit: (ref: string) => Promise<string>;
  getCommit: (sha: string) => Promise<CommitDetails>;
  listChanges: (base: string | null, head: string) => Promise<ChangeSet>;
  getFileDiff: (request: FileDiffRequest) => Promise<FileDiff>;
  listCommits: (query: HistoryQuery) => Promise<HistoryPage>;
  compareCommits: (base: string, head: string) => Promise<Comparison>;
  getReview: (target: ReviewTarget) => Promise<Review>;
  createThread: (target: ReviewTarget, anchor: ThreadAnchor, body: string) => Promise<Review>;
  editDraft: (target: ReviewTarget, id: string, body: string) => Promise<Review>;
  deleteDraft: (target: ReviewTarget, id: string) => Promise<Review>;
  addFollowUp: (target: ReviewTarget, id: string, body: string) => Promise<Review>;
  resolveThread: (target: ReviewTarget, id: string, resolved: boolean) => Promise<Review>;
  detectAgents: (refresh: boolean) => Promise<AgentStatus[]>;
  listModels: (agent: AgentId) => Promise<AgentModel[]>;
  send: (target: ReviewTarget, agent: AgentId, model: string) => Promise<Review>;
  cancelRun: (target: ReviewTarget, id: string) => Promise<Review>;
  markThreadRead: (target: ReviewTarget, id: string) => Promise<Review>;
  subscribeEvents: (key: string, handlers: EventHandlers) => Subscription;
};

function toApiError(err: unknown): ApiError {
  if (err instanceof RefError) return { error: err.message, code: err.code };
  return { error: err instanceof Error ? err.message : String(err) };
}

function reviewFailure(err: unknown): readonly [ApiError, 400 | 404 | 409 | 500] {
  if (err instanceof ReviewError) return [{ error: err.message }, err.status];
  return refFailure(err);
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

const reviewQuery = validator("query", (query, c): { commit: string } | { base: string; head: string } | Response => {
  const { commit, base, head } = query;
  if (typeof commit === "string" && OBJECT_ID.test(commit)) return { commit };
  if (typeof base === "string" && OBJECT_ID.test(base) && typeof head === "string" && OBJECT_ID.test(head)) {
    return { base, head };
  }
  return c.json({ error: "A review needs a commit, or a base and head, as full commit IDs." } satisfies ApiError, 400);
});

function reviewTargetFromQuery(query: { commit: string } | { base: string; head: string }): ReviewTarget {
  return "commit" in query ? { kind: "commit", sha: query.commit } : { kind: "compare", base: query.base, head: query.head };
}

function isReviewTarget(value: unknown): value is ReviewTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "commit") return typeof target.sha === "string" && OBJECT_ID.test(target.sha);
  if (target.kind === "compare") {
    return typeof target.base === "string" && OBJECT_ID.test(target.base) && typeof target.head === "string" && OBJECT_ID.test(target.head);
  }
  return false;
}

function isValidAnchor(value: unknown): value is ThreadAnchor {
  if (typeof value !== "object" || value === null) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.path === "string" &&
    anchor.path !== "" &&
    !anchor.path.includes("\n") &&
    (anchor.side === "old" || anchor.side === "new") &&
    Number.isInteger(anchor.startLine) &&
    (anchor.startLine as number) >= 1 &&
    Number.isInteger(anchor.endLine) &&
    (anchor.endLine as number) >= (anchor.startLine as number)
  );
}

function validBody(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim().length <= 20000;
}

const threadBody = validator("json", (body, c): { target: ReviewTarget; anchor: ThreadAnchor; body: string } | Response => {
  const { target, anchor, body: text } = (body ?? {}) as Record<string, unknown>;
  if (!isReviewTarget(target) || !isValidAnchor(anchor) || !validBody(text)) {
    return c.json({ error: "A comment needs a target, a valid anchor, and a non-empty body." } satisfies ApiError, 400);
  }
  return { target, anchor, body: (text as string).trim() };
});

const editBody = validator("json", (body, c): { target: ReviewTarget; body: string } | Response => {
  const { target, body: text } = (body ?? {}) as Record<string, unknown>;
  if (!isReviewTarget(target) || !validBody(text)) {
    return c.json({ error: "An edit needs a target and a non-empty body." } satisfies ApiError, 400);
  }
  return { target, body: (text as string).trim() };
});

const targetOnlyBody = validator("json", (body, c): { target: ReviewTarget } | Response => {
  const { target } = (body ?? {}) as Record<string, unknown>;
  if (!isReviewTarget(target)) {
    return c.json({ error: "A target is required." } satisfies ApiError, 400);
  }
  return { target };
});

const resolveBody = validator("json", (body, c): { target: ReviewTarget; resolved: boolean } | Response => {
  const { target, resolved } = (body ?? {}) as Record<string, unknown>;
  if (!isReviewTarget(target) || typeof resolved !== "boolean") {
    return c.json({ error: "A resolve needs a target and a resolved flag." } satisfies ApiError, 400);
  }
  return { target, resolved };
});

const agentsQuery = validator("query", (query): { refresh?: string } => (query.refresh === "1" ? { refresh: "1" } : {}));

function isAgentId(value: string): value is AgentId {
  return value === "claude" || value === "codex";
}

const AGENT_IDS = new Set(["claude", "codex"]);

const sendBody = validator("json", (body, c): { target: ReviewTarget; agent: AgentId; model: string } | Response => {
  const { target, agent, model } = (body ?? {}) as Record<string, unknown>;
  const trimmedModel = typeof model === "string" ? model.trim() : "";
  if (!isReviewTarget(target) || !AGENT_IDS.has(agent as string) || !MODEL_PATTERN.test(trimmedModel)) {
    return c.json({ error: "A send needs a target, an agent (claude or codex), and a model." } satisfies ApiError, 400);
  }
  return { target, agent: agent as AgentId, model: trimmedModel };
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
  getReview,
  createThread,
  editDraft,
  deleteDraft,
  addFollowUp,
  resolveThread,
  detectAgents,
  listModels,
  send,
  cancelRun,
  markThreadRead,
  subscribeEvents,
}: RouteDeps) {
  const modelsCache = new Map<AgentId, Promise<AgentModel[]>>();
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
    })
    .get("/api/review", reviewQuery, async (c) => {
      const target = reviewTargetFromQuery(c.req.valid("query"));
      try {
        return c.json(await getReview(target), 200);
      } catch (err) {
        return c.json(...refFailure(err));
      }
    })
    .post("/api/review/threads", threadBody, async (c) => {
      const { target, anchor, body } = c.req.valid("json");
      try {
        return c.json(await createThread(target, anchor, body), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .patch("/api/review/messages/:id", editBody, async (c) => {
      const { target, body } = c.req.valid("json");
      try {
        return c.json(await editDraft(target, c.req.param("id"), body), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .delete("/api/review/messages/:id", targetOnlyBody, async (c) => {
      const { target } = c.req.valid("json");
      try {
        return c.json(await deleteDraft(target, c.req.param("id")), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .post("/api/review/threads/:id/messages", editBody, async (c) => {
      const { target, body } = c.req.valid("json");
      try {
        return c.json(await addFollowUp(target, c.req.param("id"), body), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .post("/api/review/threads/:id/resolve", resolveBody, async (c) => {
      const { target, resolved } = c.req.valid("json");
      try {
        return c.json(await resolveThread(target, c.req.param("id"), resolved), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .get("/api/agents", agentsQuery, async (c) => {
      const refresh = c.req.valid("query").refresh === "1";
      try {
        const statuses = await detectAgents(refresh);
        if (refresh) modelsCache.clear();
        return c.json(statuses, 200);
      } catch (err) {
        return c.json(toApiError(err), 500);
      }
    })
    .get("/api/agents/:id/models", async (c) => {
      const id = c.req.param("id");
      if (!isAgentId(id)) {
        return c.json({ error: `"${id}" is not a supported agent.` } satisfies ApiError, 400);
      }
      try {
        const statuses = await detectAgents(false);
        const status = statuses.find((candidate) => candidate.id === id);
        if (!status || status.state !== "ready") {
          return c.json({ error: `${status?.name ?? id} is not ready.` } satisfies ApiError, 409);
        }
        let cached = modelsCache.get(id);
        if (!cached) {
          cached = listModels(id);
          modelsCache.set(id, cached);
        }
        return c.json(await cached, 200);
      } catch (err) {
        modelsCache.delete(id);
        return c.json(toApiError(err), 500);
      }
    })
    .post("/api/review/send", sendBody, async (c) => {
      const { target, agent, model } = c.req.valid("json");
      try {
        return c.json(await send(target, agent, model), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .post("/api/review/runs/:id/cancel", targetOnlyBody, async (c) => {
      const { target } = c.req.valid("json");
      try {
        return c.json(await cancelRun(target, c.req.param("id")), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .post("/api/review/threads/:id/read", targetOnlyBody, async (c) => {
      const { target } = c.req.valid("json");
      try {
        return c.json(await markThreadRead(target, c.req.param("id")), 200);
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
    })
    .get("/api/review/events", reviewQuery, async (c) => {
      const target = reviewTargetFromQuery(c.req.valid("query"));
      let key: string;
      try {
        key = (await getReview(target)).key;
      } catch (err) {
        return c.json(...reviewFailure(err));
      }
      return streamSSE(c, async (stream) => {
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let subscription: Subscription | null = null;
        let isAborted = false;
        const aborted = new Promise<void>((resolve) => {
          stream.onAbort(() => {
            isAborted = true;
            if (heartbeat) clearInterval(heartbeat);
            subscription?.unsubscribe();
            resolve();
          });
        });
        subscription = subscribeEvents(key, {
          onReview: (review) => {
            void stream.writeSSE({ event: "review", data: JSON.stringify(review) });
          },
          onActivity: (event: ActivityEvent) => {
            void stream.writeSSE({ event: "activity", data: JSON.stringify(event), id: String(event.seq) });
          },
        });
        const current = await getReview(target).catch(() => null);
        if (current) await stream.writeSSE({ event: "review", data: JSON.stringify(current) });
        for (const event of subscription.activity) {
          await stream.writeSSE({ event: "activity", data: JSON.stringify(event), id: String(event.seq) });
        }
        if (isAborted) return;
        heartbeat = setInterval(() => void stream.write(": ping\n\n"), HEARTBEAT_MS);
        await aborted;
      });
    });
}

export type AppType = ReturnType<typeof createRoutes>;
