import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { AgentStatus, Review, ReviewTarget, Run, Thread } from "../shared/api.ts";
import { threadStatus } from "../shared/review.ts";
import { AgentRunError } from "./agents/errors.ts";
import type { ReviewStore } from "./reviews.ts";
import { createRunner, type AskFn, type RunnerDeps } from "./runs.ts";

const sha = "a".repeat(40);
const target: ReviewTarget = { kind: "commit", sha };
const readyAgents: AgentStatus[] = [{ id: "claude", name: "Claude Code", state: "ready", fix: null }];
const claudeModels = [{ id: "haiku", label: "Haiku", efforts: [], defaultEffort: null }];

function draftThread(id: string): Thread {
  return {
    id,
    anchor: { path: "src/a.ts", side: "new", startLine: 1, endLine: 1 },
    messages: [{ id: `${id}-m1`, author: "reviewer", body: `about ${id}`, createdAt: "d", state: "draft" }],
    resolved: false,
    createdAt: "d",
  };
}

function sentThread(id: string): Thread {
  return {
    ...draftThread(id),
    messages: [{ id: `${id}-m1`, author: "reviewer", body: `about ${id}`, createdAt: "d", state: "sent" }],
  };
}

function makeReview(threads: Thread[], runs: Run[] = []): Review {
  return { key: sha, target, base: null, head: sha, threads, runs, nextThread: threads.length + 1, revision: 0, generation: "g1" };
}

function makeStore(initial: Review): ReviewStore & { current: () => Review } {
  let review = initial;
  return {
    async get() {
      return review;
    },
    async update(_target, fn) {
      review = await fn(review);
      return review;
    },
    current: () => review,
  };
}

function changeCollector() {
  const calls: string[] = [];
  let waiters: Array<() => void> = [];
  const onChange = (key: string) => {
    calls.push(key);
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  };
  const waitFor = (count: number) =>
    new Promise<void>((resolve) => {
      if (calls.length >= count) return resolve();
      waiters.push(() => calls.length >= count && resolve());
    });
  return { onChange, calls, waitFor };
}

function makeRunner(overrides: Partial<RunnerDeps> & { store: RunnerDeps["store"] }) {
  const { onChange, calls, waitFor } = changeCollector();
  const runner = createRunner({
    ask: async () => ({ summary: "ok", replies: [], unanswered: [] }),
    agents: async () => readyAgents,
    listModels: async () => claudeModels,
    context: async () => ({ headSubject: "x", snippets: new Map() }),
    onChange,
    ...overrides,
  });
  return { runner, calls, waitFor };
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid!;
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

function runOwnedBy(overrides: Partial<Run>): Run {
  return {
    id: "stale",
    agent: "claude",
    model: "haiku",
    effort: null,
    state: "running",
    threadIds: ["t1"],
    startedAt: "d",
    endedAt: null,
    summary: null,
    error: null,
    owner: { pid: 1, instance: "other-instance" },
    ...overrides,
  };
}

describe("createRunner.send", () => {
  it("marks every draft sent and starts a running run owned by this process, in one update", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { runner, calls } = makeRunner({ store, ask: () => new Promise(() => {}) });

    const review = await runner.send(target, "claude", "haiku");

    expect(review.threads.every((t) => t.messages.every((m) => m.author !== "reviewer" || m.state === "sent"))).toBe(true);
    expect(review.runs).toHaveLength(1);
    expect(review.runs[0]).toMatchObject({ agent: "claude", model: "haiku", effort: null, state: "running", threadIds: ["t1", "t2"], endedAt: null });
    expect(review.runs[0].owner?.pid).toBe(process.pid);
    expect(typeof review.runs[0].owner?.instance).toBe("string");
    expect(calls).toEqual([sha]);
  });

  it("rejects with 400 when there is nothing to send", async () => {
    const store = makeStore(makeReview([]));
    const { runner } = makeRunner({ store });

    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects with 409 (naming the agent) and marks nothing sent when the agent is not ready", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store, agents: async () => [{ id: "claude", name: "Claude Code", state: "signed-out", fix: "x" }] });

    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Claude Code") });
    expect(store.current().runs).toEqual([]);
    expect(store.current().threads[0].messages[0]).toMatchObject({ state: "draft" });
  });

  it("stores the effort on the run and hands it to the agent", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const asked: unknown[] = [];
    const { runner, waitFor } = makeRunner({
      store,
      listModels: async () => [{ id: "opus", label: "Opus", efforts: ["low", "high"], defaultEffort: null }],
      ask: async (options) => {
        asked.push(options.effort);
        return { summary: "ok", replies: [], unanswered: [] };
      },
    });

    const review = await runner.send(target, "claude", "opus", "high");
    await waitFor(2);

    expect(review.runs[0].effort).toBe("high");
    expect(asked).toEqual(["high"]);
  });

  it("rejects with 409 and marks nothing sent when the model does not offer the effort", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store });

    await expect(runner.send(target, "claude", "haiku", "high")).rejects.toMatchObject({
      status: 409,
      message: "Haiku does not offer the high effort.",
    });
    expect(store.current().runs).toEqual([]);
  });

  it("rejects with 409 and marks nothing sent when the model is not one the agent offers", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store, listModels: async () => claudeModels });

    await expect(runner.send(target, "claude", "not-a-model")).rejects.toMatchObject({
      status: 409,
      message: "not-a-model is not a model Claude Code offers.",
    });
    expect(store.current().runs).toEqual([]);
    expect(store.current().threads[0].messages[0]).toMatchObject({ state: "draft" });
  });

  it("retries sent-but-unanswered threads when there are no drafts", async () => {
    const store = makeStore(makeReview([sentThread("t1")]));
    const { runner } = makeRunner({ store });

    const review = await runner.send(target, "claude", "haiku");
    expect(review.runs[0].threadIds).toEqual(["t1"]);
  });

  it("excludes resolved threads from a send, even when they have a draft or are unanswered", async () => {
    const resolvedDraft = { ...draftThread("t1"), resolved: true };
    const resolvedSent = { ...sentThread("t2"), resolved: true };
    const store = makeStore(makeReview([resolvedDraft, resolvedSent, draftThread("t3")]));
    const { runner } = makeRunner({ store });

    const review = await runner.send(target, "claude", "haiku");
    expect(review.runs[0].threadIds).toEqual(["t3"]);
  });

  it("rejects with 400 when the only threads are resolved", async () => {
    const store = makeStore(makeReview([{ ...draftThread("t1"), resolved: true }]));
    const { runner } = makeRunner({ store });

    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 400 });
  });
});

describe("createRunner reconciliation", () => {
  it("reconciles a running run with a dead-pid owner to interrupted, with its thread shown as no reply, and lets a new send succeed", async () => {
    const dead = await deadPid();
    const stale = runOwnedBy({ owner: { pid: dead, instance: "old-instance" } });
    const store = makeStore(makeReview([sentThread("t1")], [stale]));
    const { runner } = makeRunner({ store });

    const reconciled = await runner.get(target);
    const staleAfter = reconciled.runs.find((r) => r.id === "stale")!;
    expect(staleAfter.state).toBe("interrupted");
    expect(staleAfter.error).toBe("Outil stopped before the agent answered.");
    expect(staleAfter.endedAt).not.toBeNull();
    expect(threadStatus(reconciled.threads[0], reconciled.runs)).toBe("failed");

    const sent = await runner.send(target, "claude", "haiku");
    expect(sent.runs.find((r) => r.id !== "stale")?.state).toBe("running");
  });

  it("reconciles a running run with no owner to interrupted", async () => {
    const stale = runOwnedBy({ owner: null });
    const store = makeStore(makeReview([sentThread("t1")], [stale]));
    const { runner } = makeRunner({ store });

    const reconciled = await runner.get(target);
    expect(reconciled.runs[0].state).toBe("interrupted");
  });

  it("leaves a run owned by another live process untouched", async () => {
    const live = runOwnedBy({ owner: { pid: process.ppid, instance: "other-instance" } });
    const store = makeStore(makeReview([sentThread("t1")], [live]));
    const { runner } = makeRunner({ store });

    const reconciled = await runner.get(target);
    expect(reconciled.runs[0].state).toBe("running");
  });

  it("reconciles a queued run with a dead-pid owner to interrupted and keeps a queued run owned by this instance", async () => {
    const dead = await deadPid();
    const foreign = runOwnedBy({ id: "foreign", state: "queued", threadIds: ["t1"], owner: { pid: dead, instance: "old-instance" } });
    const store = makeStore(makeReview([sentThread("t1"), draftThread("t2")], [foreign]));
    const { runner } = makeRunner({ store, ask: () => new Promise(() => {}), maxRuns: 1 });

    const sent = await runner.send(target, "claude", "haiku", null, ["t2"]);
    expect(sent.runs.find((r) => r.id === "foreign")).toMatchObject({
      state: "interrupted",
      error: "Outil stopped before the agent answered.",
    });
    expect(sent.runs.find((r) => r.id !== "foreign")?.state).toBe("running");

    const second = await runner.send(target, "claude", "haiku", null, ["t1"]);
    expect(second.runs.find((r) => r.id === "foreign")?.state).toBe("interrupted");
    expect(second.runs.at(-1)?.state).toBe("queued");
    expect((await runner.get(target)).runs.at(-1)?.state).toBe("queued");
  });

  it("interrupts a run older than the time limit even when its owner pid is alive", async () => {
    const old = runOwnedBy({
      owner: { pid: process.ppid, instance: "other-instance" },
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const store = makeStore(makeReview([sentThread("t1")], [old]));
    const { runner } = makeRunner({ store, timeoutMs: 1000 });

    const reconciled = await runner.get(target);
    expect(reconciled.runs[0].state).toBe("interrupted");
  });
});

describe("createRunner follow-ups", () => {
  it("includes a prior run's reply in the prompt when a follow-up is sent to a different agent/model", async () => {
    const followUpThread: Thread = {
      id: "t1",
      anchor: { path: "src/a.ts", side: "new", startLine: 1, endLine: 1 },
      messages: [
        { id: "m1", author: "reviewer", body: "Why this approach?", createdAt: "d", state: "sent" },
        { id: "m2", author: "agent", body: "Because it avoids an N+1.", createdAt: "d", agent: "claude", model: "haiku", runId: "r0", read: true },
        { id: "m3", author: "reviewer", body: "Does this scale though?", createdAt: "d", state: "draft" },
      ],
      resolved: false,
      createdAt: "d",
    };
    const priorRun: Run = {
      id: "r0",
      agent: "claude",
      model: "haiku",
      effort: null,
      state: "done",
      threadIds: ["t1"],
      startedAt: "d",
      endedAt: "d",
      summary: "Looks fine.",
      error: null,
      owner: null,
    };
    const store = makeStore(makeReview([followUpThread], [priorRun]));
    const prompts: string[] = [];
    const ask: AskFn = async (options) => {
      prompts.push(options.prompt);
      return { summary: "ok", replies: [{ threadId: "t1", body: "Yes, it scales." }], unanswered: [] };
    };
    const { runner, waitFor } = makeRunner({
      store,
      ask,
      agents: async () => [{ id: "codex", name: "Codex", state: "ready", fix: null }],
      listModels: async () => [{ id: "gpt-5.6-luna", label: "gpt-5.6-luna", efforts: [], defaultEffort: null }],
    });

    const sent = await runner.send(target, "codex", "gpt-5.6-luna");
    expect(sent.runs.at(-1)).toMatchObject({ agent: "codex", model: "gpt-5.6-luna", threadIds: ["t1"] });
    await waitFor(2);

    expect(prompts[0]).toContain("Agent (claude · haiku): Because it avoids an N+1.");
    expect(prompts[0]).toContain("Reviewer: Does this scale though?");

    const review = store.current();
    const thread = review.threads[0];
    expect(thread.messages.at(-1)).toMatchObject({ author: "agent", agent: "codex", model: "gpt-5.6-luna", body: "Yes, it scales." });
  });
});

describe("createRunner background run", () => {
  it("appends a reply to the right thread only, and leaves the rest unanswered", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const ask: AskFn = async () => ({
      summary: "Looks fine overall.",
      replies: [
        { threadId: "t1", body: "Reply for t1." },
        { threadId: "not-a-real-thread", body: "Should be dropped." },
      ],
      unanswered: ["t2"],
    });
    const { runner, waitFor } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku");
    await waitFor(2);

    const review = store.current();
    const t1 = review.threads.find((t) => t.id === "t1")!;
    const t2 = review.threads.find((t) => t.id === "t2")!;
    expect(t1.messages.at(-1)).toMatchObject({ author: "agent", body: "Reply for t1." });
    expect(t2.messages).toHaveLength(1);
    expect(review.threads.flatMap((t) => t.messages).some((m) => m.body === "Should be dropped.")).toBe(false);

    const run = review.runs[0];
    expect(run.state).toBe("done");
    expect(run.summary).toBe("Looks fine overall.");
    expect(threadStatus(t2, review.runs)).toBe("failed");
    expect(threadStatus(t1, review.runs)).toBe("answered");
  });

  it("maps AgentRunError kinds to run states, and other errors to failed", async () => {
    const cases: Array<[() => Promise<never>, string]> = [
      [() => Promise.reject(new AgentRunError("timeout", "too slow")), "timed-out"],
      [() => Promise.reject(new AgentRunError("cancelled", "stopped")), "cancelled"],
      [() => Promise.reject(new AgentRunError("invalid", "bad json")), "failed"],
      [() => Promise.reject(new AgentRunError("failed", "boom")), "failed"],
      [() => Promise.reject(new Error("plain error")), "failed"],
    ];
    for (const [ask, expectedState] of cases) {
      const store = makeStore(makeReview([draftThread("t1")]));
      const { runner, waitFor } = makeRunner({ store, ask });

      await runner.send(target, "claude", "haiku");
      await waitFor(2);

      const run = store.current().runs[0];
      expect(run.state).toBe(expectedState);
      expect(run.error).not.toBeNull();
    }
  });

  it("marks an invalid answer as failed with a composed message, and writes no agent message", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const ask: AskFn = async () => {
      throw new AgentRunError("invalid", "not a JSON object");
    };
    const { runner, waitFor } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku");
    await waitFor(2);

    const review = store.current();
    const run = review.runs[0];
    expect(run.state).toBe("failed");
    expect(run.error).toBe("The agent's answer was not in the expected format: not a JSON object.");
    expect(run.errorKind).toBe("invalid");
    expect(review.threads[0].messages).toHaveLength(1);
    expect(review.threads.flatMap((t) => t.messages).some((m) => m.author === "agent")).toBe(false);
  });

  it("lets the same thread be sent again after the run fails", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const ask: AskFn = async () => {
      throw new AgentRunError("failed", "boom");
    };
    const { runner, waitFor } = makeRunner({ store, ask });

    const first = await runner.send(target, "claude", "haiku");
    await waitFor(2);
    expect(store.current().runs[0].state).toBe("failed");

    const retried = await runner.send(target, "claude", "haiku");
    expect(retried.runs.at(-1)).toMatchObject({ state: "running", threadIds: first.runs[0].threadIds });
  });

  it("lets the same thread be sent again after the run times out", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const ask: AskFn = async () => {
      throw new AgentRunError("timeout", "The agent did not answer within 10 minutes and was stopped.");
    };
    const { runner, waitFor } = makeRunner({ store, ask });

    const first = await runner.send(target, "claude", "haiku");
    await waitFor(2);
    expect(store.current().runs[0].state).toBe("timed-out");

    const retried = await runner.send(target, "claude", "haiku");
    expect(retried.runs.at(-1)).toMatchObject({ state: "running", threadIds: first.runs[0].threadIds });
  });

  it("sets errorKind from the AgentRunError kind and message, undefined for a plain failure", async () => {
    const cases: Array<[() => Promise<never>, string | undefined]> = [
      [() => Promise.reject(new AgentRunError("missing", "Claude Code is not installed.")), "missing"],
      [() => Promise.reject(new AgentRunError("failed", "Not signed in. Run claude auth login.")), "agent"],
      [() => Promise.reject(new AgentRunError("invalid", "malformed replies")), "invalid"],
      [() => Promise.reject(new AgentRunError("failed", "boom")), undefined],
      [() => Promise.reject(new AgentRunError("failed", "The author field broke the authorization header parser.")), undefined],
      [() => Promise.reject(new AgentRunError("failed", "401 Unauthorized")), "agent"],
      [() => Promise.reject(new AgentRunError("failed", "429 Too Many Requests")), "rate-limit"],
      [() => Promise.reject(new AgentRunError("failed", "API is overloaded")), "rate-limit"],
      [() => Promise.reject(new AgentRunError("failed", "Rate limited: not signed in")), "rate-limit"],
      [() => Promise.reject(new AgentRunError("timeout", "too slow")), undefined],
    ];
    for (const [ask, expectedKind] of cases) {
      const store = makeStore(makeReview([draftThread("t1")]));
      const { runner, waitFor } = makeRunner({ store, ask });

      await runner.send(target, "claude", "haiku");
      await waitFor(2);

      expect(store.current().runs[0].errorKind).toBe(expectedKind);
    }
  });

  it("calls onChange after the send update and again after the run finishes", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner, calls, waitFor } = makeRunner({ store });

    await runner.send(target, "claude", "haiku");
    await waitFor(2);

    expect(calls).toEqual([sha, sha]);
  });

  it("stopAll aborts every live run and waits until its cancelled state is persisted", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const ask: AskFn = (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new AgentRunError("cancelled", "The run was cancelled.")));
      });
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku");
    await runner.stopAll();

    const run = store.current().runs[0];
    expect(run.state).toBe("cancelled");
    expect(run.endedAt).not.toBeNull();
  });
});

describe("createRunner.cancel", () => {
  function abortableAsk(): AskFn {
    return (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new AgentRunError("cancelled", "The run was cancelled.")));
      });
  }

  it("rejects with 404 for an unknown run id", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store });

    await expect(runner.cancel(target, "no-such-run")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects with 409 when the run has already finished", async () => {
    const done: Run = { ...runOwnedBy({}), id: "r1", state: "done", endedAt: "d" };
    const store = makeStore(makeReview([sentThread("t1")], [done]));
    const { runner } = makeRunner({ store });

    await expect(runner.cancel(target, "r1")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects with 409 for a run that is running but not owned by this process", async () => {
    const live = runOwnedBy({ owner: { pid: process.ppid, instance: "other-instance" } });
    const store = makeStore(makeReview([sentThread("t1")], [live]));
    const { runner } = makeRunner({ store });

    await expect(runner.cancel(target, "stale")).rejects.toMatchObject({ status: 409 });
  });

  it("aborts the live run and resolves once it is persisted as cancelled, with a reviewer-facing message", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store, ask: abortableAsk() });

    const sent = await runner.send(target, "claude", "haiku");
    const runId = sent.runs[0].id;

    const review = await runner.cancel(target, runId);
    const run = review.runs.find((candidate) => candidate.id === runId)!;
    expect(run.state).toBe("cancelled");
    expect(run.error).toBe("Cancelled by the reviewer.");
    expect(run.endedAt).not.toBeNull();
    expect(threadStatus(review.threads[0], review.runs)).toBe("failed");
  });

  it("gives up waiting after cancelWaitMs and returns the review as it currently stands", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const ask: AskFn = () => new Promise(() => {});
    const { runner } = makeRunner({ store, ask, cancelWaitMs: 50 });

    const sent = await runner.send(target, "claude", "haiku");
    const runId = sent.runs[0].id;

    const review = await runner.cancel(target, runId);
    expect(review.runs.find((candidate) => candidate.id === runId)?.state).toBe("running");
  });

  it("a cancelled run's threads can be sent again", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store, ask: abortableAsk() });

    const sent = await runner.send(target, "claude", "haiku");
    await runner.cancel(target, sent.runs[0].id);

    const review = await runner.send(target, "claude", "haiku");
    expect(review.runs.at(-1)?.state).toBe("running");
    expect(review.runs.at(-1)?.threadIds).toEqual(["t1"]);
  });
});

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("condition not met");
}

function gatedAsk() {
  const gates: Array<{ options: Parameters<AskFn>[0]; open: (answer?: Awaited<ReturnType<AskFn>>) => void; fail: (err: unknown) => void }> = [];
  const ask: AskFn = (options) =>
    new Promise((resolve, reject) => {
      gates.push({ options, open: (answer) => resolve(answer ?? { summary: "ok", replies: [], unanswered: [] }), fail: reject });
    });
  return { ask, gates };
}

const stateOf = (store: { current: () => Review }, index: number) => store.current().runs[index]?.state;

describe("createRunner concurrency", () => {
  it("runs two sends on different threads concurrently", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    await until(() => gates.length === 2);

    expect(store.current().runs.map((r) => r.state)).toEqual(["running", "running"]);
    expect(store.current().runs.map((r) => r.threadIds)).toEqual([["t1"], ["t2"]]);
  });

  it("keeps a third send queued at maxRuns=2 and starts it when one finishes", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2"), draftThread("t3")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    const third = await runner.send(target, "claude", "haiku", null, ["t3"]);
    expect(third.runs.map((r) => r.state)).toEqual(["running", "running", "queued"]);
    expect(gates).toHaveLength(2);

    gates[0].open();
    await until(() => stateOf(store, 2) === "running");
    expect(stateOf(store, 0)).toBe("done");
    await until(() => gates.length === 3);
  });

  it("honours a custom maxRuns", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    const second = await runner.send(target, "claude", "haiku", null, ["t2"]);

    expect(second.runs.map((r) => r.state)).toEqual(["running", "queued"]);
    expect(gates).toHaveLength(1);
  });

  it("does not let a run blocked on a busy thread block a later run on a free thread", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2"), draftThread("t3"), draftThread("t4")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 2 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    gates[1].open();
    await until(() => stateOf(store, 1) === "done");

    await runner.send(target, "claude", "haiku", null, ["t1", "t3"]);
    await runner.send(target, "claude", "haiku", null, ["t4"]);

    expect(store.current().runs.map((r) => r.state)).toEqual(["running", "done", "queued", "running"]);
  });

  it("queues Send now on a thread in a running run and starts it after, with the first answer in its prompt", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await until(() => gates.length === 1);
    store.current().threads[0].messages.push({ id: "f1", author: "reviewer", body: "Follow-up?", createdAt: "d", state: "draft" });

    const second = await runner.send(target, "claude", "haiku", null, ["t1"]);
    expect(second.runs.map((r) => r.state)).toEqual(["running", "queued"]);
    expect(gates).toHaveLength(1);

    gates[0].open({ summary: "s", replies: [{ threadId: "t1", body: "First answer." }], unanswered: [] });
    await until(() => gates.length === 2);

    expect(gates[1].options.prompt).toContain("Agent (claude · haiku): First answer.");
    expect(gates[1].options.prompt).toContain("Reviewer: Follow-up?");
    expect(stateOf(store, 0)).toBe("done");
    expect(stateOf(store, 1)).toBe("running");
  });

  it("absorbs Send now on a thread in a queued run into that run", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    store.current().threads[1].messages.push({ id: "f2", author: "reviewer", body: "More on t2", createdAt: "d", state: "draft" });

    const absorbed = await runner.send(target, "claude", "haiku", null, ["t2"]);

    expect(absorbed.runs).toHaveLength(2);
    expect(absorbed.threads[1].messages.at(-1)).toMatchObject({ id: "f2", state: "sent" });

    gates[0].open();
    await until(() => gates.length === 2);
    expect(gates[1].options.prompt).toContain("Reviewer: More on t2");
  });

  it("excludes threads already in a queued or running run from a batch send", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2"), draftThread("t3"), draftThread("t4")]));
    const { ask } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    const batch = await runner.send(target, "claude", "haiku");

    expect(batch.runs.at(-1)?.threadIds).toEqual(["t3", "t4"]);
    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 400, message: "There is nothing to send." });
  });

  it("rejects Send now for a resolved thread, an unknown thread, or a thread the agent answered last", async () => {
    const answered: Thread = {
      ...draftThread("t3"),
      messages: [
        { id: "a", author: "reviewer", body: "q", createdAt: "d", state: "sent" },
        { id: "b", author: "agent", body: "x", createdAt: "d", agent: "claude", model: "haiku", runId: "r", read: true },
      ],
    };
    const store = makeStore(makeReview([{ ...draftThread("t1"), resolved: true }, draftThread("t2"), answered]));
    const { runner } = makeRunner({ store });

    for (const ids of [["t1"], ["nope"], ["t3"], ["t2", "t3"]]) {
      await expect(runner.send(target, "claude", "haiku", null, ids)).rejects.toMatchObject({ status: 400 });
    }
    expect(store.current().runs).toEqual([]);
    expect(store.current().threads[1].messages[0]).toMatchObject({ state: "draft" });
  });
});

describe("createRunner reply placement", () => {
  it("keeps a follow-up draft added mid-run after the agent answer, and the thread sendable again", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku");
    await until(() => gates.length === 1);
    expect(store.current().runs[0].replyAfter).toEqual({ t1: "t1-m1" });
    store.current().threads[0].messages.push({ id: "f1", author: "reviewer", body: "Follow-up", createdAt: "d", state: "draft" });

    gates[0].open({ summary: "s", replies: [{ threadId: "t1", body: "A1" }], unanswered: [] });
    await until(() => stateOf(store, 0) === "done");

    const thread = store.current().threads[0];
    expect(thread.messages.map((m) => m.body)).toEqual(["about t1", "A1", "Follow-up"]);
    expect(threadStatus(thread, store.current().runs)).toBe("draft");

    const resent = await runner.send(target, "claude", "haiku");
    expect(resent.runs.at(-1)?.threadIds).toEqual(["t1"]);
  });

  it("appends the answer when the anchor message is missing, and accepts stored runs without replyAfter", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask });

    await runner.send(target, "claude", "haiku");
    await until(() => gates.length === 1);
    const run = store.current().runs[0];
    delete run.replyAfter;

    gates[0].open({ summary: "s", replies: [{ threadId: "t1", body: "A1" }], unanswered: [] });
    await until(() => stateOf(store, 0) === "done");

    expect(store.current().threads[0].messages.map((m) => m.body)).toEqual(["about t1", "A1"]);
  });
});

describe("createRunner cancel and stop with queued runs", () => {
  it("cancels a queued run without aborting anything, and lets later runs start", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    const queuedReview = await runner.send(target, "claude", "haiku", null, ["t2"]);
    const queuedId = queuedReview.runs[1].id;

    const review = await runner.cancel(target, queuedId);

    expect(review.runs[1]).toMatchObject({ state: "cancelled", error: "Cancelled by the reviewer." });
    expect(review.runs[1].endedAt).not.toBeNull();
    expect(review.runs[0].state).toBe("running");
    expect(gates[0].options.signal?.aborted).toBe(false);
    expect(threadStatus(review.threads[1], review.runs)).toBe("failed");
  });

  it("stopAll aborts running runs and leaves queued runs queued", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const ask: AskFn = (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new AgentRunError("cancelled", "The run was cancelled.")));
      });
    const { runner } = makeRunner({ store, ask, maxRuns: 1 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    await runner.stopAll();

    expect(store.current().runs.map((r) => r.state)).toEqual(["cancelled", "queued"]);
  });
});

describe("createRunner rate-limit backoff", () => {
  const rateLimited = () => new AgentRunError("failed", "429 Too Many Requests");

  it("pauses scheduling after a rate-limit failure and resumes when the pause ends", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1, backoffMs: 60 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    gates[0].fail(rateLimited());
    await until(() => stateOf(store, 0) === "failed");

    expect(store.current().runs[0].errorKind).toBe("rate-limit");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stateOf(store, 1)).toBe("queued");

    await until(() => stateOf(store, 1) === "running");
    await until(() => gates.length === 2);
  });

  it("doubles the pause on consecutive rate limits and resets it after a success", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2"), draftThread("t3"), draftThread("t4")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1, backoffMs: 80 });

    for (const id of ["t1", "t2", "t3", "t4"]) await runner.send(target, "claude", "haiku", null, [id]);

    const startedAt = Date.now();
    gates[0].fail(rateLimited());
    await until(() => stateOf(store, 1) === "running");
    const firstPause = Date.now() - startedAt;
    expect(firstPause).toBeGreaterThanOrEqual(70);

    const secondStart = Date.now();
    gates[1].fail(rateLimited());
    await until(() => stateOf(store, 2) === "running");
    const secondPause = Date.now() - secondStart;
    expect(secondPause).toBeGreaterThanOrEqual(150);

    gates[2].open();
    await until(() => stateOf(store, 3) === "running");

    const thirdStart = Date.now();
    gates[3].fail(rateLimited());
    await until(() => stateOf(store, 3) === "failed");
    await runner.send(target, "claude", "haiku", null, ["t4"]);
    expect(stateOf(store, 4)).toBe("queued");
    await until(() => stateOf(store, 4) === "running");
    const resumed = Date.now() - thirdStart;
    expect(resumed).toBeGreaterThanOrEqual(70);
    expect(resumed).toBeLessThan(150);
  });

  it("does not pause for other failures", async () => {
    const store = makeStore(makeReview([draftThread("t1"), draftThread("t2")]));
    const { ask, gates } = gatedAsk();
    const { runner } = makeRunner({ store, ask, maxRuns: 1, backoffMs: 5000 });

    await runner.send(target, "claude", "haiku", null, ["t1"]);
    await runner.send(target, "claude", "haiku", null, ["t2"]);
    gates[0].fail(new AgentRunError("failed", "boom"));
    await until(() => stateOf(store, 1) === "running");
  });
});
