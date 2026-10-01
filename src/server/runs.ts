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
  onChange?: (key: string) => void;
  onActivity?: (key: string, runId: string, text: string) => void;
  isAlivePid?: (pid: number) => boolean;
};

export type Runner = {
  send(target: ReviewTarget, agent: AgentId, model: string): Promise<Review>;
  get(target: ReviewTarget): Promise<Review>;
  cancel(target: ReviewTarget, runId: string): Promise<Review>;
  stopAll(): Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
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

function sendableThreads(review: Review): Thread[] {
  return review.threads.filter((thread) => {
    if (thread.resolved) return false;
    const last = thread.messages[thread.messages.length - 1];
    return last?.author === "reviewer";
  });
}

function stateForError(err: unknown): Exclude<RunState, "running" | "interrupted"> {
  if (err instanceof AgentRunError) {
    if (err.kind === "timeout") return "timed-out";
    if (err.kind === "cancelled") return "cancelled";
    return "failed";
  }
  return "failed";
}

const AGENT_AVAILABILITY_PATTERN =
  /\b(auth(entication)?|o?auth token|log ?in|api key|not signed in|unauthori[sz]ed|authori[sz]ation (failed|required|error)|token (expired|invalid))\b/i;

function errorKindFor(err: unknown): Run["errorKind"] {
  if (!(err instanceof AgentRunError)) return undefined;
  if (err.kind === "missing") return "missing";
  if (err.kind === "invalid") return "invalid";
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
      return { ...thread, messages: [...thread.messages, message] };
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
  const staleAfterMs = timeoutMs + STALE_MARGIN_MS;

  function isOwnerAlive(run: Run): boolean {
    const owner = run.owner;
    if (!owner) return false;
    if (owner.instance === instance) return live.has(run.id) || pending.has(run.id);
    if (Date.now() - Date.parse(run.startedAt) > staleAfterMs) return false;
    return isAlivePid(owner.pid);
  }

  function reconcile(review: Review): Review {
    const now = new Date().toISOString();
    let changed = false;
    const runs = review.runs.map((run) => {
      if (run.state !== "running" || isOwnerAlive(run)) return run;
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

  async function finish(target: ReviewTarget, key: string, runId: string, outcome: Outcome): Promise<void> {
    const cancelMessage = reviewerCancelled.has(runId) ? CANCELLED_BY_REVIEWER_MESSAGE : undefined;
    try {
      await store.update(target, (review) => applyOutcome(review, runId, outcome, cancelMessage));
    } catch (err) {
      console.error(`outil: failed to record the outcome of run ${runId} for ${key}:`, err);
    }
    live.delete(runId);
    reviewerCancelled.delete(runId);
    notifyChange(key);
  }

  function startRun(target: ReviewTarget, review: Review, runId: string): void {
    const run = review.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    const controller = new AbortController();

    const task = (async () => {
      let prompt: string;
      try {
        const promptCtx = await context(review);
        prompt = buildPrompt(review, promptCtx);
      } catch (err) {
        await finish(target, review.key, runId, { kind: "error", err });
        return;
      }
      try {
        const answer = await ask({
          sha: review.head,
          agent: run.agent,
          model: run.model,
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

  return {
    async send(target, agent, model) {
      const statuses = await agents();
      const status = statuses.find((candidate) => candidate.id === agent);
      if (status?.state !== "ready") {
        throw new ReviewError(409, `${AGENT_NAMES[agent]} is not ready to run. Check the Agents panel.`, status?.fix ?? null);
      }
      const models = await listModels(agent);
      if (!models.some((candidate) => candidate.id === model)) {
        throw new ReviewError(409, `${model} is not a model ${AGENT_NAMES[agent]} offers.`);
      }

      const runId = crypto.randomUUID();
      pending.add(runId);
      let updated: Review;
      try {
        updated = await store.update(target, (input) => {
        const review = reconcile(input);
        if (review.runs.some((run) => run.state === "running")) {
          throw new ReviewError(409, "A run is already in progress for this review.");
        }
        const targets = sendableThreads(review);
        if (targets.length === 0) throw new ReviewError(400, "There is nothing to send.");
        const threadIds = targets.map((thread) => thread.id);
        const idSet = new Set(threadIds);
        const now = new Date().toISOString();
        const threads = review.threads.map((thread) =>
          !idSet.has(thread.id)
            ? thread
            : {
                ...thread,
                messages: thread.messages.map((message) =>
                  message.author === "reviewer" && message.state === "draft" ? { ...message, state: "sent" as const } : message,
                ),
              },
        );
        const run: Run = {
          id: runId,
          agent,
          model,
          state: "running",
          threadIds,
          startedAt: now,
          endedAt: null,
          summary: null,
          error: null,
          owner: { pid: process.pid, instance },
        };
        return { ...review, threads, runs: [...review.runs, run] };
        });
        startRun(target, updated, runId);
      } finally {
        pending.delete(runId);
      }

      notifyChange(updated.key);
      return updated;
    },
    get(target) {
      return reconcileStored(target);
    },
    async cancel(target, runId) {
      const review = await reconcileStored(target);
      const run = review.runs.find((candidate) => candidate.id === runId);
      if (!run) throw new ReviewError(404, `No run with id ${runId}.`);
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
      const entries = [...live.values()];
      for (const entry of entries) entry.controller.abort();
      return Promise.all(entries.map((entry) => entry.done)).then(() => undefined);
    },
  };
}
