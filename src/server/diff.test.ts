import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFileDiff, MAX_FILE_BYTES, parsePatch } from "./diff.ts";
import { RefError } from "./errors.ts";

describe("parsePatch", () => {
  it("parses multiple hunks, including the hunk header text after the second @@", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "index 0000000..1111111 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,2 +1,2 @@",
      "-old1",
      "+new1",
      " same",
      "@@ -10,3 +10,4 @@ function foo() {",
      " ctx1",
      "+added",
      " ctx2",
      " ctx3",
      "",
    ].join("\n");

    expect(parsePatch(patch)).toEqual([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "",
        lines: [
          { kind: "del", text: "old1" },
          { kind: "add", text: "new1" },
          { kind: "context", text: "same" },
        ],
      },
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        header: "function foo() {",
        lines: [
          { kind: "context", text: "ctx1" },
          { kind: "add", text: "added" },
          { kind: "context", text: "ctx2" },
          { kind: "context", text: "ctx3" },
        ],
      },
    ]);
  });

  it("treats an omitted count in the hunk header as 1", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", ""].join("\n");

    expect(parsePatch(patch)).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "",
        lines: [
          { kind: "del", text: "a" },
          { kind: "add", text: "b" },
        ],
      },
    ]);
  });

  it('ignores "\\ No newline at end of file" markers', () => {
    const patch = ["@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file", ""].join("\n");

    expect(parsePatch(patch)).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "",
        lines: [
          { kind: "del", text: "old" },
          { kind: "add", text: "new" },
        ],
      },
    ]);
  });

  it('parses a deleted or added line whose content itself starts with "-- " or "++ "', () => {
    const patch = ["@@ -1,1 +1,1 @@", "--- old marker", "+++ new marker", ""].join("\n");

    expect(parsePatch(patch)).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: "",
        lines: [
          { kind: "del", text: "-- old marker" },
          { kind: "add", text: "++ new marker" },
        ],
      },
    ]);
  });
});

const dirs: string[] = [];

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-diff-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  return { dir, git };
}

function write(dir: string, path: string, content: string | Buffer) {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("getFileDiff", () => {
  it("diffs a modified file, returning its hunks and both full texts", async () => {
    const { dir, git } = makeRepo();
    write(dir, "file.txt", "a\nb\nc\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "file.txt", "a\nB\nc\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "file.txt", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBe("a\nb\nc\n");
    expect(diff.newText).toBe("a\nB\nc\n");
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "context", text: "c" },
    ]);
  });

  it("diffs an added file, with a null old text", async () => {
    const { dir, git } = makeRepo();
    write(dir, "file.txt", "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "new.txt", "x\ny\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "new.txt", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBeNull();
    expect(diff.newText).toBe("x\ny\n");
    expect(diff.hunks[0].lines).toEqual([
      { kind: "add", text: "x" },
      { kind: "add", text: "y" },
    ]);
  });

  it("diffs a deleted file, with a null new text", async () => {
    const { dir, git } = makeRepo();
    write(dir, "gone.txt", "x\ny\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    git("rm", "-q", "gone.txt");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "gone.txt", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBe("x\ny\n");
    expect(diff.newText).toBeNull();
  });

  it("diffs the root commit against an empty tree when base is null", async () => {
    const { dir, git } = makeRepo();
    write(dir, "file.txt", "a\nb\n");
    git("add", "-A");
    git("commit", "-q", "-m", "root");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base: null, head, path: "file.txt", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBeNull();
    expect(diff.newText).toBe("a\nb\n");
    expect(diff.hunks[0].lines).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("diffs a renamed file, reading old text from the old path", async () => {
    const { dir, git } = makeRepo();
    write(dir, "old.txt", "a\nb\nc\nd\ne\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    git("mv", "old.txt", "new.txt");
    write(dir, "new.txt", "a\nb\nX\nd\ne\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "new.txt", oldPath: "old.txt", full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBe("a\nb\nc\nd\ne\n");
    expect(diff.newText).toBe("a\nb\nX\nd\ne\n");
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines).toContainEqual({ kind: "del", text: "c" });
    expect(diff.hunks[0].lines).toContainEqual({ kind: "add", text: "X" });
  });

  it("reports a binary file instead of parsing hunks", async () => {
    const { dir, git } = makeRepo();
    write(dir, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 4]));
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "logo.png", oldPath: null, full: false });
    expect(diff).toEqual({ kind: "binary" });
  });

  it(
    "reports a file above MAX_FILE_BYTES as too large, and returns its text when full is set",
    async () => {
      const { dir, git } = makeRepo();
      write(dir, "big.txt", "small\n");
      git("add", "-A");
      git("commit", "-q", "-m", "one");
      const base = git("rev-parse", "HEAD");
      const big = "a".repeat(MAX_FILE_BYTES + 500);
      write(dir, "big.txt", big);
      git("add", "-A");
      git("commit", "-q", "-m", "two");
      const head = git("rev-parse", "HEAD");

      const tooLarge = await getFileDiff(dir, { base, head, path: "big.txt", oldPath: null, full: false });
      expect(tooLarge).toEqual({ kind: "too-large", bytes: big.length });

      const full = await getFileDiff(dir, { base, head, path: "big.txt", oldPath: null, full: true });
      if (full.kind !== "text") throw new Error(`expected text, got ${full.kind}`);
      expect(full.oldText).toBe("small\n");
      expect(full.newText).toBe(big);
    },
    20000,
  );

  it("matches a path containing glob characters literally, not as a glob", async () => {
    const { dir, git } = makeRepo();
    write(dir, "src/a[1]*.ts", "one\n");
    write(dir, "src/a1x.ts", "sibling\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "src/a[1]*.ts", "two\n");
    write(dir, "src/a1x.ts", "sibling changed\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(dir, { base, head, path: "src/a[1]*.ts", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBe("one\n");
    expect(diff.newText).toBe("two\n");
  });

  it("keeps a file apart from a directory that later takes its name", async () => {
    const { dir, git } = makeRepo();
    write(dir, "foo", "file\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    git("rm", "-q", "foo");
    write(dir, "foo/bar", "nested\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const file = await getFileDiff(dir, { base, head, path: "foo", oldPath: null, full: false });
    const nested = await getFileDiff(dir, { base, head, path: "foo/bar", oldPath: null, full: false });
    if (file.kind !== "text" || nested.kind !== "text") throw new Error("expected text diffs");
    expect(file.hunks.flatMap((h) => h.lines)).toEqual([{ kind: "del", text: "file" }]);
    expect(nested.hunks.flatMap((h) => h.lines)).toEqual([{ kind: "add", text: "nested" }]);
  });

  it("works when cwd is a subfolder of the repository", async () => {
    const { dir, git } = makeRepo();
    write(dir, "file.txt", "a\n");
    mkdirSync(join(dir, "sub"), { recursive: true });
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "file.txt", "b\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const diff = await getFileDiff(join(dir, "sub"), { base, head, path: "file.txt", oldPath: null, full: false });
    if (diff.kind !== "text") throw new Error(`expected text, got ${diff.kind}`);
    expect(diff.oldText).toBe("a\n");
    expect(diff.newText).toBe("b\n");
  });

  it('rejects a missing commit id with a RefError coded "unknown"', async () => {
    const { dir, git } = makeRepo();
    write(dir, "file.txt", "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    git("rev-parse", "HEAD");

    const err = await getFileDiff(dir, { base: null, head: "0".repeat(40), path: "file.txt", oldPath: null, full: false }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RefError);
    expect((err as RefError).code).toBe("unknown");
  });
});
