import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askAgent } from "./ask.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-ask-repo-"));
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

describe("askAgent", () => {
  it("runs against a read-only commit snapshot, drops ghost replies, and reports unanswered threads", async () => {
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
        "CWD=$(pwd)",
        "CONTENT=$(cat greet.txt)",
        'echo "leaked" > hack.txt',
        "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"summary\":\"ok\",\"replies\":[{\"threadId\":\"t1\",\"body\":\"pwd:%s content:%s\"},{\"threadId\":\"ghost\",\"body\":\"nope\"}]}}\\n' \"$CWD\" \"$CONTENT\"",
        "exit 0",
      ].join("\n"),
    );

    const answer = await askAgent({
      repoRoot: dir,
      sha,
      agent: "claude",
      model: "haiku",
      prompt: "hello",
      threadIds: ["t1", "t2"],
      env: fakeEnv(bin),
    });

    expect(answer.replies).toHaveLength(1);
    const [reply] = answer.replies;
    expect(reply.threadId).toBe("t1");
    expect(reply.body).toContain("committed-content");
    expect(reply.body).not.toContain("dirty-content-not-committed");
    expect(answer.unanswered).toEqual(["t2"]);

    const match = /pwd:(\S+) content:/.exec(reply.body);
    expect(match).not.toBeNull();
    const snapshotDir = match![1];
    expect(snapshotDir).not.toBe(dir);
    expect(existsSync(snapshotDir)).toBe(false);
    expect(existsSync(join(dir, "hack.txt"))).toBe(false);

    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
