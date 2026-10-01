import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeSet, Review, ReviewTarget, Thread } from "../shared/api.ts";
import { askAgent } from "./agents/ask.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./agents/fixtures.ts";
import { promptContext } from "./agents/prompt.ts";
import { getCommit } from "./git.ts";
import type { ReviewStore } from "./reviews.ts";
import { createRoutes } from "./routes.ts";
import { createRunner } from "./runs.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-runs-e2e-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  return { dir, git };
}

async function fakeDir(): Promise<string> {
  const dir = await makeFakeBinDir();
  dirs.push(dir);
  return dir;
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

describe("createRunner end-to-end with a fake CLI", () => {
  it("replies reflect the committed content, even when the working copy changed since, and the repo stays clean", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "greet.txt"), "committed-content");
    git("add", "greet.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    writeFileSync(join(dir, "greet.txt"), "dirty-content-not-committed");
    const statusBefore = git("status", "--porcelain");
    expect(statusBefore).toContain("M greet.txt");

    const bin = await fakeDir();
    await writeFake(
      bin,
      "claude",
      [
        "cat > /dev/null &",
        "CONTENT=$(cat greet.txt)",
        "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"summary\":\"reviewed\",\"replies\":[{\"threadId\":\"t1\",\"body\":\"content:%s\"}]}}\\n' \"$CONTENT\"",
        "exit 0",
      ].join("\n"),
    );

    const thread: Thread = {
      id: "t1",
      anchor: { path: "greet.txt", side: "new", startLine: 1, endLine: 1 },
      messages: [{ id: "m1", author: "reviewer", body: "What is this?", createdAt: "d", state: "draft" }],
      resolved: false,
      createdAt: "d",
    };
    const target: ReviewTarget = { kind: "commit", sha };
    const review: Review = { key: sha, target, base: null, head: sha, threads: [thread], runs: [], nextThread: 2, revision: 0, generation: "g1" };
    const store = makeStore(review);

    let waiters: Array<() => void> = [];
    const changeCount = { n: 0 };
    const onChange = () => {
      changeCount.n++;
      const pending = waiters;
      waiters = [];
      for (const wake of pending) wake();
    };
    const waitFor = (count: number) =>
      new Promise<void>((resolve) => {
        if (changeCount.n >= count) return resolve();
        waiters.push(() => changeCount.n >= count && resolve());
      });

    const noRenames = async (): Promise<ChangeSet> => ({ base: null, head: "", files: [], additions: 0, deletions: 0 });
    const runner = createRunner({
      store,
      ask: (options) => askAgent({ repoRoot: dir, ...options, env: fakeEnv(bin) }),
      agents: async () => [{ id: "claude", name: "Claude Code", state: "ready", fix: null }],
      listModels: async () => [{ id: "haiku", label: "Haiku", efforts: [], defaultEffort: null }],
      context: (r) => promptContext(dir, r, (commitSha) => getCommit(dir, commitSha), noRenames),
      onChange,
    });

    await runner.send(target, "claude", "haiku");
    await waitFor(2);

    const finalReview = store.current();
    const finalThread = finalReview.threads[0];
    const agentMessage = finalThread.messages.find((m) => m.author === "agent");
    expect(agentMessage).toBeDefined();
    expect(agentMessage!.body).toContain("committed-content");
    expect(agentMessage!.body).not.toContain("dirty-content-not-committed");
    expect(finalReview.runs[0].state).toBe("done");

    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 20_000);
});

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

describe("POST /api/review/runs/:id/cancel — a fake CLI that ignores SIGTERM", () => {
  it("leaves no process behind once the cancel request resolves", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "greet.txt"), "hello");
    git("add", "greet.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    const bin = await fakeDir();
    const work = await fakeDir();
    const pidFile = join(work, "pid.txt");
    await writeFake(bin, "claude", `cat > /dev/null &\ntrap '' TERM\necho $$ > '${pidFile}'\nsleep 30`);

    const thread: Thread = {
      id: "t1",
      anchor: { path: "greet.txt", side: "new", startLine: 1, endLine: 1 },
      messages: [{ id: "m1", author: "reviewer", body: "What is this?", createdAt: "d", state: "draft" }],
      resolved: false,
      createdAt: "d",
    };
    const target: ReviewTarget = { kind: "commit", sha };
    const review: Review = { key: sha, target, base: null, head: sha, threads: [thread], runs: [], nextThread: 2, revision: 0, generation: "g1" };
    const store = makeStore(review);
    const noRenames = async (): Promise<ChangeSet> => ({ base: null, head: "", files: [], additions: 0, deletions: 0 });
    const runner = createRunner({
      store,
      ask: (options) => askAgent({ repoRoot: dir, ...options, env: fakeEnv(bin) }),
      agents: async () => [{ id: "claude", name: "Claude Code", state: "ready", fix: null }],
      listModels: async () => [{ id: "haiku", label: "Haiku", efforts: [], defaultEffort: null }],
      context: (r) => promptContext(dir, r, (commitSha) => getCommit(dir, commitSha), noRenames),
      onChange: () => {},
    });

    const unstubbed = async (): Promise<never> => {
      throw new Error("not stubbed");
    };
    const app = createRoutes({
      repoInfo: unstubbed,
      listRefs: unstubbed,
      resolveCommit: unstubbed,
      getCommit: unstubbed,
      listChanges: unstubbed,
      getFileDiff: unstubbed,
      listCommits: unstubbed,
      compareCommits: unstubbed,
      getReview: (t) => runner.get(t),
      createThread: unstubbed,
      editDraft: unstubbed,
      deleteDraft: unstubbed,
      addFollowUp: unstubbed,
      resolveThread: unstubbed,
      detectAgents: unstubbed,
      listModels: unstubbed,
      send: (t, agent, model) => runner.send(t, agent, model),
      cancelRun: (t, id) => runner.cancel(t, id),
      markThreadRead: unstubbed,
      subscribeEvents: () => ({ activity: [], unsubscribe: () => {} }),
    });

    const sendRes = await app.request("/api/review/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, agent: "claude", model: "haiku" }),
    });
    expect(sendRes.status).toBe(200);
    const sent = (await sendRes.json()) as Review;
    const runId = sent.runs[0].id;

    await waitUntil(() => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(isAlive(pid)).toBe(true);

    const cancelRes = await app.request(`/api/review/runs/${runId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as Review;
    expect(cancelled.runs.find((r) => r.id === runId)?.state).toBe("cancelled");

    expect(isAlive(pid)).toBe(false);
  }, 20_000);
});
