import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewTarget } from "../shared/api.ts";
import { assertCommits, compareCommits, getCommit } from "./git.ts";
import { createFileStore } from "./reviewFiles.ts";
import { createTargetResolver, createThread, type ResolveTarget } from "./reviews.ts";

const dirs: string[] = [];

function makeRepo(): { dir: string; git: (...args: string[]) => string; commit: (content: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-reviewfiles-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const commit = (content: string) => {
    writeFileSync(join(dir, "file.txt"), content);
    git("add", "file.txt");
    git("commit", "-q", "-m", content);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function resolverFor(cwd: string): ResolveTarget {
  return createTargetResolver({
    assertCommits: (...shas) => assertCommits(cwd, ...shas),
    getCommit: (sha) => getCommit(cwd, sha),
    compareCommits: (base, head) => compareCommits(cwd, base, head),
  });
}

const anchor = { path: "file.txt", side: "new" as const, startLine: 1, endLine: 1 };

describe("createFileStore", () => {
  it("persists changes across two store instances, as after a restart", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const target: ReviewTarget = { kind: "commit", sha };

    const store1 = createFileStore(dir, resolverFor(dir));
    await store1.update(target, (review) => createThread(review, anchor, "looks off"));

    const store2 = createFileStore(dir, resolverFor(dir));
    const reloaded = await store2.get(target);
    expect(reloaded.threads).toHaveLength(1);
    expect(reloaded.threads[0].messages[0]).toMatchObject({ body: "looks off", state: "draft" });
  });

  it("round-trips a draft, a sent message, an agent message, and resolved state", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const target: ReviewTarget = { kind: "commit", sha };

    const store1 = createFileStore(dir, resolverFor(dir));
    await store1.update(target, (review) => {
      const withThread = createThread(review, anchor, "please check");
      const threadId = withThread.threads[0].id;
      return {
        ...withThread,
        threads: withThread.threads.map((t) =>
          t.id !== threadId
            ? t
            : {
                ...t,
                resolved: true,
                messages: [
                  { ...t.messages[0], state: "sent" as const },
                  {
                    id: "agent-1",
                    author: "agent" as const,
                    body: "fixed",
                    createdAt: new Date().toISOString(),
                    agent: "claude" as const,
                    model: "sonnet",
                    runId: "run-1",
                    read: false,
                  },
                ],
              },
        ),
        runs: [
          {
            id: "run-1",
            agent: "claude" as const,
            model: "sonnet",
            state: "done" as const,
            threadIds: [threadId],
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            summary: "done",
            error: null,
            owner: null,
          },
        ],
      };
    });

    const store2 = createFileStore(dir, resolverFor(dir));
    const reloaded = await store2.get(target);
    expect(reloaded.threads).toHaveLength(1);
    expect(reloaded.threads[0].resolved).toBe(true);
    expect(reloaded.threads[0].messages).toHaveLength(2);
    expect(reloaded.threads[0].messages[0]).toMatchObject({ author: "reviewer", state: "sent" });
    expect(reloaded.threads[0].messages[1]).toMatchObject({ author: "agent", body: "fixed", read: false });
    expect(reloaded.runs).toHaveLength(1);
    expect(reloaded.runs[0]).toMatchObject({ id: "run-1", state: "done" });
  });

  it("keeps a commit review and a compare review with the same shas isolated", async () => {
    const { dir, commit } = makeRepo();
    const first = commit("one");
    const second = commit("two");

    const store = createFileStore(dir, resolverFor(dir));
    await store.update({ kind: "commit", sha: second }, (review) => createThread(review, anchor, "on the commit"));
    const compareReview = await store.get({ kind: "compare", base: first, head: second });

    expect(compareReview.threads).toEqual([]);
  });

  it("keeps different commits isolated", async () => {
    const { dir, commit } = makeRepo();
    const first = commit("one");
    const second = commit("two");

    const store = createFileStore(dir, resolverFor(dir));
    await store.update({ kind: "commit", sha: first }, (review) => createThread(review, anchor, "on first"));
    const other = await store.get({ kind: "commit", sha: second });

    expect(other.threads).toEqual([]);
  });

  it("keeps two different repositories isolated", async () => {
    const repoA = makeRepo();
    const repoB = makeRepo();
    const shaA = repoA.commit("one");
    const shaB = repoB.commit("one");

    const storeA = createFileStore(repoA.dir, resolverFor(repoA.dir));
    const storeB = createFileStore(repoB.dir, resolverFor(repoB.dir));
    await storeA.update({ kind: "commit", sha: shaA }, (review) => createThread(review, anchor, "repo a"));

    const reviewB = await storeB.get({ kind: "commit", sha: shaB });
    expect(reviewB.threads).toEqual([]);
    const reviewA = await storeA.get({ kind: "commit", sha: shaA });
    expect(reviewA.threads).toHaveLength(1);
  });

  it("shares review data between a worktree and the main checkout", async () => {
    const { dir, git, commit } = makeRepo();
    const sha = commit("one");
    const worktreeDir = join(tmpdir(), `outil-reviewfiles-wt-${Date.now()}`);
    git("worktree", "add", "-q", worktreeDir, "-b", "wt-branch", sha);
    dirs.push(worktreeDir);

    const mainStore = createFileStore(dir, resolverFor(dir));
    await mainStore.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "from main"));

    const worktreeStore = createFileStore(worktreeDir, resolverFor(worktreeDir));
    const fromWorktree = await worktreeStore.get({ kind: "commit", sha });
    expect(fromWorktree.threads).toHaveLength(1);
    expect(fromWorktree.threads[0].messages[0].body).toBe("from main");
  });

  it("discards a corrupt review file, warns, and starts fresh", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const reviewsDir = join(dir, commonDir, "outil", "reviews");
    execFileSync("mkdir", ["-p", reviewsDir]);
    writeFileSync(join(reviewsDir, `${sha}.json`), "{ not json");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createFileStore(dir, resolverFor(dir));
    const review = await store.get({ kind: "commit", sha });

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    expect(review.threads).toEqual([]);
    const files = readdirSync(reviewsDir);
    expect(files).not.toContain(`${sha}.json`);
    expect(files.some((f) => f.startsWith(`${sha}.json.corrupt-`))).toBe(true);
  });

  it("fills in defaults for a review file missing newer fields", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const reviewsDir = join(dir, commonDir, "outil", "reviews");
    execFileSync("mkdir", ["-p", reviewsDir]);
    const legacy = {
      key: sha,
      target: { kind: "commit", sha },
      base: null,
      head: sha,
      threads: [{ id: "t1", anchor, messages: [], resolved: false, createdAt: new Date().toISOString() }],
    };
    writeFileSync(join(reviewsDir, `${sha}.json`), JSON.stringify(legacy));

    const store = createFileStore(dir, resolverFor(dir));
    const review = await store.get({ kind: "commit", sha });

    expect(review.runs).toEqual([]);
    expect(review.nextThread).toBe(2);
    expect(review.revision).toBe(0);
    expect(typeof review.generation).toBe("string");
    expect(review.generation.length).toBeGreaterThan(0);
  });

  it("rejects a review file with malformed thread shapes as corrupt", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const reviewsDir = join(dir, commonDir, "outil", "reviews");
    execFileSync("mkdir", ["-p", reviewsDir]);
    const malformed = { key: sha, target: { kind: "commit", sha }, base: null, head: sha, threads: [{}], runs: [] };
    writeFileSync(join(reviewsDir, `${sha}.json`), JSON.stringify(malformed));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createFileStore(dir, resolverFor(dir));
    const review = await store.get({ kind: "commit", sha });

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    expect(review.threads).toEqual([]);
    const files = readdirSync(reviewsDir);
    expect(files.some((f) => f.startsWith(`${sha}.json.corrupt-`))).toBe(true);
  });

  it("writes atomically and leaves no leftover tmp files", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const store = createFileStore(dir, resolverFor(dir));
    await store.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "one"));
    await store.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "two"));

    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const reviewsDir = join(dir, commonDir, "outil", "reviews");
    const files = readdirSync(reviewsDir);
    expect(files).toEqual([`${sha}.json`]);
  });

  it("only writes and bumps the revision when the review actually changed", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const store = createFileStore(dir, resolverFor(dir));

    const first = await store.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "one"));
    expect(first.revision).toBe(1);

    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const file = join(dir, commonDir, "outil", "reviews", `${sha}.json`);
    const before = readFileSync(file, "utf8");

    const unchanged = await store.update({ kind: "commit", sha }, (review) => review);
    expect(unchanged.revision).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("never shows up as a change in the reviewed repository's git status", async () => {
    const { dir, git, commit } = makeRepo();
    const sha = commit("one");
    const store = createFileStore(dir, resolverFor(dir));

    await store.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "one"));

    expect(git("status", "--porcelain")).toBe("");
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    expect(readdirSync(join(dir, commonDir, "outil", "reviews"))).toContain(`${sha}.json`);
  });

  it("does not write anything for a review that is only read", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const store = createFileStore(dir, resolverFor(dir));

    await store.get({ kind: "commit", sha });

    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const outilDir = join(dir, commonDir, "outil");
    expect(() => readdirSync(outilDir)).toThrow();
  });

  it("keeps both writes when a second store has a stale cache from before the first write", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const target: ReviewTarget = { kind: "commit", sha };
    const storeA = createFileStore(dir, resolverFor(dir));
    const storeB = createFileStore(dir, resolverFor(dir));

    await storeB.get(target);
    await storeA.update(target, (review) => createThread(review, anchor, "from A"));
    const afterB = await storeB.update(target, (review) => createThread(review, anchor, "from B"));

    expect(afterB.threads).toHaveLength(2);
    expect(new Set(afterB.threads.map((t) => t.id)).size).toBe(2);
    expect(afterB.threads.map((t) => t.messages[0].body).sort()).toEqual(["from A", "from B"]);

    const seenByA = await storeA.get(target);
    expect(seenByA.threads).toHaveLength(2);
  });

  it("serializes truly concurrent updates from two stores via the lock file", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("one");
    const target: ReviewTarget = { kind: "commit", sha };
    const storeA = createFileStore(dir, resolverFor(dir));
    const storeB = createFileStore(dir, resolverFor(dir));

    const [a, b] = await Promise.all([
      storeA.update(target, (review) => createThread(review, anchor, "from A")),
      storeB.update(target, (review) => createThread(review, anchor, "from B")),
    ]);

    expect(new Set([...a.threads, ...b.threads].map((t) => t.id)).size).toBeGreaterThanOrEqual(1);
    const final = await storeA.get(target);
    expect(final.threads).toHaveLength(2);
    expect(new Set(final.threads.map((t) => t.id)).size).toBe(2);
  });

  it("keeps both writes between the main checkout and a worktree sharing the common dir", async () => {
    const { dir, git, commit } = makeRepo();
    const sha = commit("one");
    const worktreeDir = join(tmpdir(), `outil-reviewfiles-wt-interleave-${Date.now()}`);
    git("worktree", "add", "-q", worktreeDir, "-b", "wt-interleave", sha);
    dirs.push(worktreeDir);
    const target: ReviewTarget = { kind: "commit", sha };

    const mainStore = createFileStore(dir, resolverFor(dir));
    const worktreeStore = createFileStore(worktreeDir, resolverFor(worktreeDir));

    await worktreeStore.get(target);
    await mainStore.update(target, (review) => createThread(review, anchor, "from main"));
    const afterWorktree = await worktreeStore.update(target, (review) => createThread(review, anchor, "from worktree"));

    expect(afterWorktree.threads).toHaveLength(2);
    expect(new Set(afterWorktree.threads.map((t) => t.id)).size).toBe(2);
  });
});
