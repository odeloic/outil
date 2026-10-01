import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeSet, Review, ReviewTarget, Thread } from "../shared/api.ts";
import { askAgent } from "./agents/ask.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./agents/fixtures.ts";
import { promptContext } from "./agents/prompt.ts";
import { getCommit } from "./git.ts";
import type { ReviewStore } from "./reviews.ts";
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
      listModels: async () => [{ id: "haiku", label: "Haiku" }],
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
