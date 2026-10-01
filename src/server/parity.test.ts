import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentId, ChangeSet, Review, ReviewTarget, Thread } from "../shared/api.ts";
import { threadStatus } from "../shared/review.ts";
import { askAgent } from "./agents/ask.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./agents/fixtures.ts";
import { promptContext } from "./agents/prompt.ts";
import { getCommit } from "./git.ts";
import type { ReviewStore } from "./reviews.ts";
import { createRunner, type Runner, type RunnerDeps } from "./runs.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-parity-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  git("commit", "-q", "-m", "one");
  return { dir, git };
}

async function fakeDir(): Promise<string> {
  const dir = await makeFakeBinDir();
  dirs.push(dir);
  return dir;
}

const CWD_TOKEN = "__CWD__";

async function fakeAgentCli(
  bin: string,
  name: string,
  events: unknown[],
  opts: { promptFile?: string } = {},
): Promise<void> {
  const outputFile = join(bin, `${name}-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeFile(outputFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const captureStdin = opts.promptFile ? `cat > '${opts.promptFile}'\n` : "cat > /dev/null &\n";
  await writeFake(bin, name, `${captureStdin}sed "s#${CWD_TOKEN}#$PWD#g" '${outputFile}'\nexit 0`);
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

function draftThread(id: string, body = `about ${id}`): Thread {
  return {
    id,
    anchor: { path: "a.ts", side: "new", startLine: 1, endLine: 1 },
    messages: [{ id: `${id}-m1`, author: "reviewer", body, createdAt: "d", state: "draft" }],
    resolved: false,
    createdAt: "d",
  };
}

function makeReview(sha: string, threads: Thread[]): Review {
  const target: ReviewTarget = { kind: "commit", sha };
  return { key: sha, target, base: null, head: sha, threads, runs: [], nextThread: threads.length + 1, revision: 0, generation: "g1" };
}

function changeWaiter() {
  let n = 0;
  let waiters: Array<() => void> = [];
  const onChange = () => {
    n++;
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  };
  const waitFor = (count: number) =>
    new Promise<void>((resolve) => {
      if (n >= count) return resolve();
      waiters.push(() => n >= count && resolve());
    });
  return { onChange, waitFor };
}

const noRenames = async (): Promise<ChangeSet> => ({ base: null, head: "", files: [], additions: 0, deletions: 0 });

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

type Fixture = {
  id: AgentId;
  binName: string;
  model: string;
  doneEvents: (answer: unknown) => unknown[];
  failEvents: (message: string) => unknown[];
  invalidEvents: () => unknown[];
  activityLine: string;
};

const claudeFixture: Fixture = {
  id: "claude",
  binName: "claude",
  model: "haiku",
  doneEvents: (answer) => [
    { type: "system", subtype: "init" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: `${CWD_TOKEN}/a.txt` } },
          { type: "text", text: "Looking at the change now." },
        ],
      },
    },
    { type: "result", subtype: "success", is_error: false, structured_output: answer },
  ],
  failEvents: (message) => [{ type: "result", subtype: "error", is_error: true, result: message }],
  invalidEvents: () => [{ type: "result", subtype: "success", is_error: false, structured_output: { summary: 1, replies: [] } }],
  activityLine: "Reading a.txt",
};

const codexFixture: Fixture = {
  id: "codex",
  binName: "codex",
  model: "gpt-5.6-luna",
  doneEvents: (answer) => [
    { type: "thread.started", thread_id: "th_1" },
    { type: "turn.started" },
    { type: "item.started", item: { id: "item_0", type: "command_execution", command: `/bin/zsh -lc "sed -n '1,5p' a.txt"` } },
    { type: "item.completed", item: { id: "item_0", type: "command_execution", command: `/bin/zsh -lc "sed -n '1,5p' a.txt"` } },
    { type: "item.completed", item: { id: "item_1", type: "reasoning" } },
    { type: "item.completed", item: { id: "item_2", type: "agent_message", text: JSON.stringify(answer) } },
    { type: "turn.completed", usage: {} },
  ],
  failEvents: (message) => [{ type: "error", message: "stream interrupted" }, { type: "turn.failed", error: { message } }],
  invalidEvents: () => [{ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "not json" } }],
  activityLine: "Running sed -n '1,5p' a.txt",
};

describe.each([claudeFixture, codexFixture])("parity — $id", (fixture) => {
  function makeRunnerFor(bin: string, repoDir: string, store: ReviewStore, overrides: Partial<RunnerDeps> = {}): Runner {
    return createRunner({
      store,
      ask: (options) => askAgent({ repoRoot: repoDir, ...options, env: fakeEnv(bin) }),
      agents: async () => [{ id: fixture.id, name: fixture.id, state: "ready", fix: null }],
      listModels: async () => [{ id: fixture.model, label: fixture.model }],
      context: (r) => promptContext(repoDir, r, (sha) => getCommit(repoDir, sha), noRenames),
      onChange: () => {},
      ...overrides,
    });
  }

  it("send: replies land in the right threads and an unanswered thread shows No reply", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    await fakeAgentCli(bin, fixture.binName, fixture.doneEvents({ summary: "ok", replies: [{ threadId: "t1", body: "Looks fine." }] }));

    const store = makeStore(makeReview(sha, [draftThread("t1"), draftThread("t2")]));
    const { onChange, waitFor } = changeWaiter();
    const activity: string[] = [];
    const runner = makeRunnerFor(bin, dir, store, { onChange, onActivity: (_key, _runId, text) => activity.push(text) });

    await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    await waitFor(2);

    const review = store.current();
    expect(review.runs[0].state).toBe("done");
    const t1 = review.threads.find((t) => t.id === "t1")!;
    const t2 = review.threads.find((t) => t.id === "t2")!;
    expect(t1.messages.at(-1)).toMatchObject({ author: "agent", body: "Looks fine." });
    expect(threadStatus(t1, review.runs)).toBe("answered");
    expect(t2.messages).toHaveLength(1);
    expect(threadStatus(t2, review.runs)).toBe("failed");
    expect(activity).toContain(fixture.activityLine);
  });

  it("invalid answer: the run fails and no agent message is written", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    await fakeAgentCli(bin, fixture.binName, fixture.invalidEvents());

    const store = makeStore(makeReview(sha, [draftThread("t1")]));
    const { onChange, waitFor } = changeWaiter();
    const runner = makeRunnerFor(bin, dir, store, { onChange });

    await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    await waitFor(2);

    const review = store.current();
    expect(review.runs[0].state).toBe("failed");
    expect(review.runs[0].errorKind).toBe("invalid");
    expect(review.threads.flatMap((t) => t.messages).some((m) => m.author === "agent")).toBe(false);
  });

  it("agent failure: the agent's own error message is surfaced on the run", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    await fakeAgentCli(bin, fixture.binName, fixture.failEvents("The sandbox refused a write."));

    const store = makeStore(makeReview(sha, [draftThread("t1")]));
    const { onChange, waitFor } = changeWaiter();
    const runner = makeRunnerFor(bin, dir, store, { onChange });

    await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    await waitFor(2);

    const review = store.current();
    expect(review.runs[0].state).toBe("failed");
    expect(review.runs[0].error).toBe("The sandbox refused a write.");
  });

  it("timeout: a run that never answers is stopped and reported as timed out, with the whole process group killed", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const work = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const pidFile = join(work, "pid.txt");
    const childPidFile = join(work, "child.txt");
    await writeFake(
      bin,
      fixture.binName,
      `cat > /dev/null &\nsleep 30 &\necho $! > '${childPidFile}'\necho $$ > '${pidFile}'\nwait`,
    );

    const store = makeStore(makeReview(sha, [draftThread("t1")]));
    const { onChange, waitFor } = changeWaiter();
    const runner = makeRunnerFor(bin, dir, store, { onChange, timeoutMs: 2_000 });

    await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    await waitFor(2);

    const review = store.current();
    expect(review.runs[0].state).toBe("timed-out");
    expect(review.runs[0].error).toContain("and was stopped.");

    const pid = Number(readFileSync(pidFile, "utf8").trim());
    const childPid = Number(readFileSync(childPidFile, "utf8").trim());
    await waitUntil(() => !isAlive(pid));
    await waitUntil(() => !isAlive(childPid));
  }, 15_000);

  it("cancel: kills the process group of a fake CLI that ignores SIGTERM", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const work = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const pidFile = join(work, "pid.txt");
    const childPidFile = join(work, "child.txt");
    await writeFake(
      bin,
      fixture.binName,
      `cat > /dev/null &\ntrap '' TERM\nsleep 30 &\necho $! > '${childPidFile}'\necho $$ > '${pidFile}'\nwait`,
    );

    const store = makeStore(makeReview(sha, [draftThread("t1")]));
    const runner = makeRunnerFor(bin, dir, store);

    const sent = await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    const runId = sent.runs[0].id;

    await waitUntil(() => existsSync(pidFile) && existsSync(childPidFile));
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    const childPid = Number(readFileSync(childPidFile, "utf8").trim());
    expect(isAlive(pid)).toBe(true);
    expect(isAlive(childPid)).toBe(true);

    const review = await runner.cancel({ kind: "commit", sha }, runId);
    expect(review.runs.find((r) => r.id === runId)?.state).toBe("cancelled");
    await waitUntil(() => !isAlive(pid), 6000);
    await waitUntil(() => !isAlive(childPid), 6000);
  }, 20_000);

  it("follow-up: the prompt sent to the agent contains the prior conversation", async () => {
    const { dir } = makeRepo();
    const bin = await fakeDir();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const promptFile = join(await fakeDir(), "prompt.txt");
    await fakeAgentCli(bin, fixture.binName, fixture.doneEvents({ summary: "ok", replies: [{ threadId: "t1", body: "Still looks fine." }] }), {
      promptFile,
    });

    const followUpThread: Thread = {
      id: "t1",
      anchor: { path: "a.ts", side: "new", startLine: 1, endLine: 1 },
      messages: [
        { id: "m1", author: "reviewer", body: "Why export a const here?", createdAt: "d", state: "sent" },
        { id: "m2", author: "agent", body: "It keeps the binding immutable.", createdAt: "d", agent: fixture.id, model: fixture.model, runId: "r0", read: true },
        { id: "m3", author: "reviewer", body: "Does that still hold with the new change?", createdAt: "d", state: "draft" },
      ],
      resolved: false,
      createdAt: "d",
    };
    const review = makeReview(sha, [followUpThread]);
    review.runs.push({
      id: "r0",
      agent: fixture.id,
      model: fixture.model,
      state: "done",
      threadIds: ["t1"],
      startedAt: "d",
      endedAt: "d",
      summary: "Initial pass looked fine.",
      error: null,
      owner: null,
    });
    const store = makeStore(review);
    const { onChange, waitFor } = changeWaiter();
    const runner = makeRunnerFor(bin, dir, store, { onChange });

    await runner.send({ kind: "commit", sha }, fixture.id, fixture.model);
    await waitFor(2);

    const prompt = await waitForFile(promptFile);
    expect(prompt).toContain(`Agent (${fixture.id} · ${fixture.model}): It keeps the binding immutable.`);
    expect(prompt).toContain("Reviewer: Does that still hold with the new change?");
    expect(prompt).toContain("Needs a reply.");

    const finalThread = store.current().threads[0];
    expect(finalThread.messages.at(-1)).toMatchObject({ author: "agent", agent: fixture.id, model: fixture.model, body: "Still looks fine." });
  });
});

async function waitForFile(path: string): Promise<string> {
  await waitUntil(() => existsSync(path) && readFileSync(path, "utf8").length > 0);
  return readFileSync(path, "utf8");
}
