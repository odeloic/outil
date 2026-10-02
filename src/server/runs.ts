import type { AgentId, AgentMessage, AgentModel, AgentStatus, Review, ReviewTarget, Run, RunState, Thread } from "../shared/api.ts";
import type { AskAgentOptions } from "./agents/ask.ts";
import type { ParsedAnswer } from "./agents/answer.ts";
import { AgentRunError } from "./agents/errors.ts";
import { buildPrompt, type PromptContext } from "./agents/prompt.ts";
import { ReviewError, type ReviewStore } from "./reviews.ts";
import { AGENT_NAMES } from "../shared/agents.ts";

export type AskFn = (options: Omit<AskAgentOptions, "repoRoot">) => Promise<ParsedAnswer>;

export type RunnerDeps = {
  store: ReviewStore;
  ask: AskFn;
  agents: () => Promise<AgentStatus[]>;
  listModels: (agent: AgentId) => Promise<AgentModel[]>;
  context: (review: Review) => Promise<PromptContext>;
  timeoutMs?: number;
  cancelWaitMs?: number;
  maxRuns?: number;
  backoffMs?: number;
  onChange?: (key: string) => void;
  onActivity?: (key: string, runId: string, text: string) => void;
  isAlivePid?: (pid: number) => boolean;
};

export type Runner = {
  send(target: ReviewTarget, agent: AgentId, model: string, effort?: string | null, threadIds?: string[]): Promise<Review>;
  get(target: ReviewTarget): Promise<Review>;
  cancel(target: ReviewTarget, runId: string): Promise<Review>;
  stopAll(): Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RUNS = 2;
const DEFAULT_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_FACTOR = 4;
const STALE_MARGIN_MS = 60 * 1000;
const CANCEL_WAIT_MS = 10 * 1000;
const CANCELLED_BY_REVIEWER_MESSAGE = "Cancelled by the reviewer.";
const INTERRUPTED_MESSAGE = "Outil stopped before the agent answered.";

function defaultIsAlivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isSendable(thread: Thread): boolean {
  if (thread.resolved) return false;
  const last = thread.messages[thread.messages.length - 1];
  return last?.author === "reviewer";
}

function threadIdsIn(review: Review, states: RunState[]): Set<string> {
  return new Set(review.runs.filter((run) => states.includes(run.state)).flatMap((run) => run.threadIds));
}

function markSent(thread: Thread): Thread {
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.author === "reviewer" && message.state === "draft" ? { ...message, state: "sent" as const } : message,
    ),
  };
}

function stateForError(err: unknown): Exclude<RunState, "queued" | "running" | "interrupted"> {
  if (err instanceof AgentRunError) {
    if (err.kind === "timeout") return "timed-out";
    if (err.kind === "cancelled") return "cancelled";
    return "failed";
  }
  return "failed";
}

const AGENT_AVAILABILITY_PATTERN =
  /\b(auth(entication)?|o?auth token|log ?in|api key|not signed in|unauthori[sz]ed|authori[sz]ation (failed|required|error)|token (expired|invalid))\b/i;

const RATE_LIMIT_PATTERN = /\b(rate[ -]?limit(ed)?|429|too many requests|overloaded)\b/i;

function errorKindFor(err: unknown): Run["errorKind"] {
  if (!(err instanceof AgentRunError)) return undefined;
  if (err.kind === "missing") return "missing";
  if (err.kind === "invalid") return "invalid";
  if (err.kind === "failed" && RATE_LIMIT_PATTERN.test(err.message)) return "rate-limit";
  if (err.kind === "failed" && AGENT_AVAILABILITY_PATTERN.test(err.message)) return "agent";
  return undefined;
}

type Outcome = { kind: "done"; answer: ParsedAnswer } | { kind: "error"; err: unknown };

function applyOutcome(review: Review, runId: string, outcome: Outcome, cancelMessage?: string): Review {
  const now = new Date().toISOString();
  const run = review.runs.find((candidate) => candidate.id === runId);
  if (!run) return review;

  if (outcome.kind === "done") {
    const repliesByThread = new Map(outcome.answer.replies.map((reply) => [reply.threadId, reply.body]));
    const threads = review.threads.map((thread) => {
      const body = repliesByThread.get(thread.id);
      if (body === undefined || !run.threadIds.includes(thread.id)) return thread;
      const message: AgentMessage = {
        id: crypto.randomUUID(),
        author: "agent",
        body,
        createdAt: now,
        agent: run.agent,
        model: run.model,
        runId,
        read: false,
      };
      const anchorId = run.replyAfter?.[thread.id];
      const anchorIndex = anchorId === undefined ? -1 : thread.messages.findIndex((candidate) => candidate.id === anchorId);
      const messages =
        anchorIndex === -1
          ? [...thread.messages, message]
          : [...thread.messages.slice(0, anchorIndex + 1), message, ...thread.messages.slice(anchorIndex + 1)];
      return { ...thread, messages };
    });
    const runs = review.runs.map((candidate) =>
      candidate.id === runId ? { ...candidate, state: "done" as const, summary: outcome.answer.summary, endedAt: now } : candidate,
    );
    return { ...review, threads, runs };
  }

  const state = stateForError(outcome.err);
  const errorKind = errorKindFor(outcome.err);
  const message =
    state === "cancelled" && cancelMessage
      ? cancelMessage
      : outcome.err instanceof AgentRunError && outcome.err.kind === "invalid"
        ? `The agent's answer was not in the expected format: ${outcome.err.message}.`
        : outcome.err instanceof Error
          ? outcome.err.message
          : String(outcome.err);
  const runs = review.runs.map((candidate) =>
    candidate.id === runId ? { ...candidate, state, error: message, errorKind, endedAt: now } : candidate,
  );
  return { ...review, runs };
}

export function createRunner({
  store,
  ask,
  agents,
  listModels,
  context,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cancelWaitMs = CANCEL_WAIT_MS,
  maxRuns = DEFAULT_MAX_RUNS,
  backoffMs = DEFAULT_BACKOFF_MS,
  onChange,
  onActivity,
  isAlivePid = defaultIsAlivePid,
}: RunnerDeps): Runner {
  const notifyChange = onChange ?? (() => {});
  const notifyActivity = onActivity ?? (() => {});
  const instance = crypto.randomUUID();
  const live = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const pending = new Set<string>();
  const reviewerCancelled = new Set<string>();
  const schedulers = new Map<string, Promise<unknown>>();
  const backoffs = new Map<string, { failures: number; until: number; timer: ReturnType<typeof setTimeout> | null }>();
  let stopping = false;
  const staleAfterMs = timeoutMs + STALE_MARGIN_MS;

  function isOwnerAlive(run: Run): boolean {
    const owner = run.owner;
    if (!owner) return false;
    if (owner.instance === instance) return run.state === "queued" || live.has(run.id) || pending.has(run.id);
    if (Date.now() - Date.parse(run.startedAt) > staleAfterMs) return false;
    return isAlivePid(owner.pid);
  }

  function reconcile(review: Review): Review {
    const now = new Date().toISOString();
    let changed = false;
    const runs = review.runs.map((run) => {
      if ((run.state !== "running" && run.state !== "queued") || isOwnerAlive(run)) return run;
      changed = true;
      return { ...run, state: "interrupted" as const, endedAt: now, error: INTERRUPTED_MESSAGE };
    });
    return changed ? { ...review, runs } : review;
  }

  async function reconcileStored(target: ReviewTarget): Promise<Review> {
    const current = await store.get(target);
    if (reconcile(current) === current) return current;
    const updated = await store.update(target, reconcile);
    notifyChange(updated.key);
    return updated;
  }

  function backoffFor(key: string) {
    let entry = backoffs.get(key);
    if (!entry) {
      entry = { failures: 0, until: 0, timer: null };
      backoffs.set(key, entry);
    }
    return entry;
  }

  function recordRunEnd(target: ReviewTarget, key: string, outcome: Outcome): void {
    const entry = backoffFor(key);
    if (outcome.kind === "done") {
      entry.failures = 0;
      entry.until = 0;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      return;
    }
    if (errorKindFor(outcome.err) !== "rate-limit") return;
    entry.failures += 1;
    const delay = Math.min(backoffMs * 2 ** (entry.failures - 1), backoffMs * MAX_BACKOFF_FACTOR);
    entry.until = Date.now() + delay;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.until = 0;
      void schedule(target);
    }, delay);
    entry.timer.unref?.();
  }

  function isPaused(key: string): boolean {
    const entry = backoffs.get(key);
    return entry !== undefined && entry.until > Date.now();
  }

  async function finish(target: ReviewTarget, key: string, runId: string, outcome: Outcome): Promise<void> {
    const cancelMessage = reviewerCancelled.has(runId) ? CANCELLED_BY_REVIEWER_MESSAGE : undefined;
    try {
      await store.update(target, (review) => applyOutcome(review, runId, outcome, cancelMessage));
    } catch (err) {
      console.error(`outil: failed to record the outcome of run ${runId} for ${key}:`, err);
    }
    live.delete(runId);
    reviewerCancelled.delete(runId);
    recordRunEnd(target, key, outcome);
    notifyChange(key);
    await schedule(target);
  }

  function launch(target: ReviewTarget, review: Review, runId: string): void {
    const run = review.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    const controller = new AbortController();

    const task = (async () => {
      let prompt: string;
      try {
        const promptCtx = await context(review);
        prompt = buildPrompt(review, promptCtx, run);
      } catch (err) {
        await finish(target, review.key, runId, { kind: "error", err });
        return;
      }
      try {
        const answer = await ask({
          sha: review.head,
          agent: run.agent,
          model: run.model,
          effort: run.effort,
          prompt,
          threadIds: run.threadIds,
          signal: controller.signal,
          timeoutMs,
          onActivity: (text) => notifyActivity(review.key, runId, text),
        });
        await finish(target, review.key, runId, { kind: "done", answer });
      } catch (err) {
        await finish(target, review.key, runId, { kind: "error", err });
      }
    })();

    live.set(runId, { controller, done: task.then(() => undefined, () => undefined) });
  }

  function startable(review: Review): Set<string> {
    const ids = new Set<string>();
    let running = review.runs.filter((run) => run.state === "running").length;
    const busy = threadIdsIn(review, ["running"]);
    for (const run of review.runs) {
      if (run.state !== "queued" || run.owner?.instance !== instance) continue;
      if (running >= maxRuns) break;
      if (run.threadIds.some((id) => busy.has(id))) continue;
      ids.add(run.id);
      running += 1;
      for (const id of run.threadIds) busy.add(id);
    }
    return ids;
  }

  async function schedulePass(target: ReviewTarget): Promise<Review | null> {
    if (stopping) return null;
    const current = await store.get(target);
    if (isPaused(current.key) || startable(reconcile(current)).size === 0) return null;

    const started: string[] = [];
    const updated = await store.update(target, (input) => {
      const review = reconcile(input);
      if (isPaused(review.key)) return review;
      const ids = startable(review);
      if (ids.size === 0) return review;
      const now = new Date().toISOString();
      const runs = review.runs.map((run) => {
        if (!ids.has(run.id)) return run;
        started.push(run.id);
        pending.add(run.id);
        const replyAfter: Record<string, string> = {};
        for (const thread of review.threads) {
          const last = thread.messages[thread.messages.length - 1];
          if (last && run.threadIds.includes(thread.id)) replyAfter[thread.id] = last.id;
        }
        return { ...run, state: "running" as const, startedAt: now, replyAfter };
      });
      return { ...review, runs };
    });
    try {
      for (const runId of started) launch(target, updated, runId);
    } finally {
      for (const runId of started) pending.delete(runId);
    }
    if (started.length === 0) return null;
    notifyChange(updated.key);
    return updated;
  }

  function schedule(target: ReviewTarget): Promise<Review | null> {
    const key = JSON.stringify(target);
    const previous = schedulers.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => schedulePass(target))
      .catch((err) => {
        console.error("outil: failed to schedule runs:", err);
        return null;
      });
    schedulers.set(key, next);
    void next.then(() => {
      if (schedulers.get(key) === next) schedulers.delete(key);
    });
    return next;
  }

  return {
    async send(target, agent, model, effort = null, requested) {
      const statuses = await agents();
      const status = statuses.find((candidate) => candidate.id === agent);
      if (status?.state !== "ready") {
        throw new ReviewError(409, `${AGENT_NAMES[agent]} is not ready to run. Check the Agents panel.`, status?.fix ?? null);
      }
      const models = await listModels(agent);
      const chosen = models.find((candidate) => candidate.id === model);
      if (!chosen) {
        throw new ReviewError(409, `${model} is not a model ${AGENT_NAMES[agent]} offers.`);
      }
      if (effort !== null && !chosen.efforts.includes(effort)) {
        throw new ReviewError(409, `${chosen.label} does not offer the ${effort} effort.`);
      }

      const runId = crypto.randomUUID();
      const updated = await store.update(target, (input) => {
        const review = reconcile(input);
        let targets: Thread[];
        if (requested) {
          const byId = new Map(review.threads.map((thread) => [thread.id, thread]));
          const unique = [...new Set(requested)];
          targets = unique.map((id) => byId.get(id)).filter((thread): thread is Thread => thread !== undefined && isSendable(thread));
          if (targets.length === 0 || targets.length !== unique.length) {
            throw new ReviewError(400, "A thread can only be sent when it is unresolved and the reviewer wrote last.");
          }
        } else {
          const taken = threadIdsIn(review, ["queued", "running"]);
          targets = review.threads.filter((thread) => isSendable(thread) && !taken.has(thread.id));
          if (targets.length === 0) throw new ReviewError(400, "There is nothing to send.");
        }

        const queued = threadIdsIn(review, ["queued"]);
        const fresh = targets.filter((thread) => !queued.has(thread.id));
        const markIds = new Set(targets.map((thread) => thread.id));
        const threads = review.threads.map((thread) => (markIds.has(thread.id) ? markSent(thread) : thread));
        if (fresh.length === 0) return { ...review, threads };

        const run: Run = {
          id: runId,
          agent,
          model,
          effort,
          state: "queued",
          threadIds: fresh.map((thread) => thread.id),
          startedAt: new Date().toISOString(),
          endedAt: null,
          summary: null,
          error: null,
          owner: { pid: process.pid, instance },
        };
        return { ...review, threads, runs: [...review.runs, run] };
      });

      const started = await schedule(target);
      if (started) return started;
      notifyChange(updated.key);
      return store.get(target);
    },
    get(target) {
      return reconcileStored(target);
    },
    async cancel(target, runId) {
      const review = await reconcileStored(target);
      const run = review.runs.find((candidate) => candidate.id === runId);
      if (!run) throw new ReviewError(404, `No run with id ${runId}.`);
      if (run.state === "queued") {
        const updated = await store.update(target, (input) => {
          const now = new Date().toISOString();
          const runs = input.runs.map((candidate) =>
            candidate.id === runId && candidate.state === "queued"
              ? { ...candidate, state: "cancelled" as const, error: CANCELLED_BY_REVIEWER_MESSAGE, endedAt: now }
              : candidate,
          );
          return { ...input, runs };
        });
        notifyChange(updated.key);
        await schedule(target);
        return store.get(target);
      }
      const entry = live.get(runId);
      if (run.state !== "running") throw new ReviewError(409, "This run is not in progress.");
      if (!entry) {
        throw new ReviewError(409, "This run was started from another Outil window and can only be cancelled there.");
      }
      reviewerCancelled.add(runId);
      entry.controller.abort();
      await Promise.race([entry.done, new Promise<void>((resolve) => setTimeout(resolve, cancelWaitMs))]);
      return store.get(target);
    },
    stopAll() {
      stopping = true;
      for (const entry of backoffs.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
      }
      const entries = [...live.values()];
      for (const entry of entries) entry.controller.abort();
      return Promise.all(entries.map((entry) => entry.done)).then(() => undefined);
    },
  };
}
