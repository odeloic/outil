import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withSnapshot } from "./snapshot.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-agents-repo-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  return { dir, git };
}

describe("withSnapshot", () => {
  it("exports the files of the reviewed commit even after the working tree changed", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.txt"), "one");
    git("add", "a.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    writeFileSync(join(dir, "a.txt"), "two (uncommitted)");
    writeFileSync(join(dir, "untracked.txt"), "new");

    let snapshotDir = "";
    const content = await withSnapshot(dir, sha, async (snapshot) => {
      snapshotDir = snapshot;
      return readFileSync(join(snapshot, "a.txt"), "utf8");
    });

    expect(content).toBe("one");
    expect(existsSync(join(snapshotDir, "untracked.txt"))).toBe(false);
  });

  it("removes the snapshot directory afterwards and leaves the repository untouched", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.txt"), "one");
    git("add", "a.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    let snapshotDir = "";
    await withSnapshot(dir, sha, async (snapshot) => {
      snapshotDir = snapshot;
    });

    expect(existsSync(snapshotDir)).toBe(false);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("removes the snapshot directory even when fn throws", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.txt"), "one");
    git("add", "a.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    let snapshotDir = "";
    await expect(
      withSnapshot(dir, sha, async (snapshot) => {
        snapshotDir = snapshot;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(snapshotDir)).toBe(false);
  });

  it("leaves the repository's own index untouched, even with a staged change present", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.txt"), "one");
    git("add", "a.txt");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    writeFileSync(join(dir, "a.txt"), "staged change");
    git("add", "a.txt");
    writeFileSync(join(dir, "untracked.txt"), "new");
    const statusBefore = git("status", "--porcelain");
    expect(statusBefore).toContain("M  a.txt");

    await withSnapshot(dir, sha, async () => {});

    expect(git("status", "--porcelain")).toBe(statusBefore);
  });

  it("checks out files that `git archive` would drop via export-ignore", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, ".gitattributes"), "secret.txt export-ignore\n");
    writeFileSync(join(dir, "secret.txt"), "should still be here");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const sha = git("rev-parse", "HEAD");

    const content = await withSnapshot(dir, sha, async (snapshot) => readFileSync(join(snapshot, "secret.txt"), "utf8"));

    expect(content).toBe("should still be here");
  });
});
