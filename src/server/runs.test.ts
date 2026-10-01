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
const claudeModels = [{ id: "haiku", label: "Haiku" }];

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
    const { runner, calls } = makeRunner({ store });

    const review = await runner.send(target, "claude", "haiku");

    expect(review.threads.every((t) => t.messages.every((m) => m.author !== "reviewer" || m.state === "sent"))).toBe(true);
    expect(review.runs).toHaveLength(1);
    expect(review.runs[0]).toMatchObject({ agent: "claude", model: "haiku", state: "running", threadIds: ["t1", "t2"], endedAt: null });
    expect(review.runs[0].owner?.pid).toBe(process.pid);
    expect(typeof review.runs[0].owner?.instance).toBe("string");
    expect(calls).toEqual([sha]);
  });

  it("rejects with 409 when a run is already in progress", async () => {
    const store = makeStore(makeReview([draftThread("t1")]));
    const { runner } = makeRunner({ store, ask: () => new Promise(() => {}) });

    await runner.send(target, "claude", "haiku");
    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 409 });
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

  it("leaves a run owned by another live process untouched, and send returns 409", async () => {
    const live = runOwnedBy({ owner: { pid: process.ppid, instance: "other-instance" } });
    const store = makeStore(makeReview([sentThread("t1")], [live]));
    const { runner } = makeRunner({ store });

    const reconciled = await runner.get(target);
    expect(reconciled.runs[0].state).toBe("running");

    await expect(runner.send(target, "claude", "haiku")).rejects.toMatchObject({ status: 409 });
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
