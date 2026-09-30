import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefError } from "./errors.ts";
import { getCommit, listChanges, listCommits, resolveCommit } from "./git.ts";

const dirs: string[] = [];

function makeRepo(): { dir: string; git: (...args: string[]) => string; commit: (content: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-git-"));
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

async function refError(promise: Promise<unknown>): Promise<RefError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(RefError);
  return err as RefError;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveCommit", () => {
  it("resolves ids, branches, tags, and relative refs to the full commit id", async () => {
    const { dir, git, commit } = makeRepo();
    const first = commit("one");
    const second = commit("two");
    git("tag", "light", first);
    git("tag", "-a", "annotated", "-m", "release", second);
    git("branch", "feature/x", first);

    expect(await resolveCommit(dir, second)).toBe(second);
    expect(await resolveCommit(dir, second.slice(0, 7))).toBe(second);
    expect(await resolveCommit(dir, "main")).toBe(second);
    expect(await resolveCommit(dir, "feature/x")).toBe(first);
    expect(await resolveCommit(dir, "light")).toBe(first);
    expect(await resolveCommit(dir, "annotated")).toBe(second);
    expect(await resolveCommit(dir, "HEAD~1")).toBe(first);
    expect(await resolveCommit(dir, "main^")).toBe(first);
  });

  it("returns a commit id that stays valid after the branch moves", async () => {
    const { dir, commit } = makeRepo();
    commit("one");
    const pinned = await resolveCommit(dir, "main");
    const moved = commit("two");

    expect(pinned).toMatch(/^[0-9a-f]{40}$/);
    expect(await resolveCommit(dir, "main")).toBe(moved);
    expect(await resolveCommit(dir, pinned)).toBe(pinned);
  });

  it("rejects unknown refs, including ones that look like flags", async () => {
    const { dir, commit } = makeRepo();
    commit("one");

    for (const ref of ["nope", "HEAD~5", "--all", "-h", "deadbeef", "  "]) {
      expect((await refError(resolveCommit(dir, ref))).code).toBe("unknown");
    }
  });

  it("rejects an abbreviated id that matches several objects", async () => {
    const { dir, commit } = makeRepo();
    commit("one");
    const seen = new Map<string, string>();
    let prefix = "";
    for (let i = 0; !prefix; i++) {
      const content = `blob ${i}`;
      const key = createHash("sha1").update(`blob ${content.length}\0${content}`).digest("hex").slice(0, 4);
      const other = seen.get(key);
      if (other === undefined) {
        seen.set(key, content);
        continue;
      }
      prefix = key;
      for (const input of [other, content]) {
        execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input });
      }
    }

    const err = await refError(resolveCommit(dir, prefix));
    expect(err.code).toBe("ambiguous");
  });

  it("rejects refs that point to something other than a commit", async () => {
    const { dir, git, commit } = makeRepo();
    commit("one");
    git("tag", "-a", "tree-tag", "-m", "tree", "HEAD^{tree}");

    const cases = [
      ["HEAD^{tree}", "tree"],
      ["HEAD:file.txt", "blob"],
      ["tree-tag", "tree"],
    ];
    for (const [ref, type] of cases) {
      const err = await refError(resolveCommit(dir, ref));
      expect(err.code).toBe("not-a-commit");
      expect(err.message).toContain(type);
    }
  });

  it("rejects refs that name more than one commit", async () => {
    const { dir, commit } = makeRepo();
    commit("one");
    commit("two");

    for (const ref of ["HEAD~1..HEAD", "HEAD~1...HEAD", "HEAD^!", "HEAD^@"]) {
      expect((await refError(resolveCommit(dir, ref))).code).toBe("not-single");
    }
  });

  it("explains a repository with no commits yet", async () => {
    const { dir } = makeRepo();

    const err = await refError(resolveCommit(dir, "HEAD"));
    expect(err.code).toBe("empty-repo");
    expect(err.message).toContain("no commits yet");
  });
});

describe("getCommit", () => {
  it("returns the author, date, parents, and message with its line breaks", async () => {
    const { dir, git, commit } = makeRepo();
    const parent = commit("one");
    writeFileSync(join(dir, "file.txt"), "two");
    git("add", "file.txt");
    git(
      "-c", "user.name=Ada Lovelace", "-c", "user.email=ada@example.com",
      "commit", "-q", "--cleanup=verbatim", "--date=2026-09-30T10:00:00+02:00",
      "-m", "Subject line", "-m", "First body line\nSecond body line\n\nNew paragraph",
    );
    const sha = git("rev-parse", "HEAD");

    expect(await getCommit(dir, sha)).toEqual({
      sha,
      parents: [parent],
      author: { name: "Ada Lovelace", email: "ada@example.com" },
      date: "2026-09-30T10:00:00+02:00",
      subject: "Subject line",
      body: "First body line\nSecond body line\n\nNew paragraph",
    });
  });

  it("returns no parents for a root commit and an empty body for a one-line message", async () => {
    const { dir, commit } = makeRepo();
    const sha = commit("only");

    const details = await getCommit(dir, sha);
    expect(details.parents).toEqual([]);
    expect(details.subject).toBe("only");
    expect(details.body).toBe("");
  });

  it("lists both parents of a merge commit, first parent first", async () => {
    const { dir, git, commit } = makeRepo();
    commit("base");
    git("switch", "-q", "-c", "side");
    writeFileSync(join(dir, "side.txt"), "side");
    git("add", "side.txt");
    git("commit", "-q", "-m", "side");
    const side = git("rev-parse", "HEAD");
    git("switch", "-q", "main");
    const main = commit("main");
    git("merge", "-q", "--no-ff", "-m", "Merge side", "side");

    const details = await getCommit(dir, git("rev-parse", "HEAD"));
    expect(details.parents).toEqual([main, side]);
    expect(details.subject).toBe("Merge side");
  });
});

describe("listChanges", () => {
  function write(dir: string, path: string, content: string | Buffer) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  it("lists every file of a root commit as added", async () => {
    const { dir, git } = makeRepo();
    write(dir, "a.txt", "one\ntwo\n");
    write(dir, "src/b.ts", "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "root");
    const head = git("rev-parse", "HEAD");

    const changes = await listChanges(dir, null, head);
    expect(changes.base).toBeNull();
    expect(changes.files).toEqual([
      { path: "a.txt", oldPath: null, status: "added", additions: 2, deletions: 0, binary: false },
      { path: "src/b.ts", oldPath: null, status: "added", additions: 1, deletions: 0, binary: false },
    ]);
    expect([changes.additions, changes.deletions]).toEqual([3, 0]);
  });

  it("reports modified, deleted, renamed, and binary files with line counts", async () => {
    const { dir, git } = makeRepo();
    write(dir, "keep.txt", "a\nb\nc\n");
    write(dir, "gone.txt", "bye\n");
    write(dir, "docs/old name.md", "line 1\nline 2\nline 3\nline 4\nline 5\n");
    write(dir, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");

    write(dir, "keep.txt", "a\nB\nc\nd\n");
    git("rm", "-q", "gone.txt");
    git("mv", "docs/old name.md", "docs/new name.md");
    write(dir, "docs/new name.md", "line 1\nline 2\nline 3\nline 4\nline five\n");
    write(dir, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 4]));
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    const head = git("rev-parse", "HEAD");

    const changes = await listChanges(dir, base, head);
    expect(changes.files).toEqual([
      { path: "docs/new name.md", oldPath: "docs/old name.md", status: "renamed", additions: 1, deletions: 1, binary: false },
      { path: "gone.txt", oldPath: null, status: "deleted", additions: 0, deletions: 1, binary: false },
      { path: "keep.txt", oldPath: null, status: "modified", additions: 2, deletions: 1, binary: false },
      { path: "logo.png", oldPath: null, status: "modified", additions: 0, deletions: 0, binary: true },
    ]);
    expect([changes.additions, changes.deletions]).toEqual([3, 3]);
  });

  it("keeps paths with leading tabs and ignores diff.relative from a subfolder", async () => {
    const { dir, git } = makeRepo();
    write(dir, "sub/a.txt", "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const base = git("rev-parse", "HEAD");
    write(dir, "\tlead.txt", "tab\n");
    write(dir, "top.txt", "top\n");
    git("add", "-A");
    git("commit", "-q", "-m", "two");
    git("config", "diff.relative", "true");

    const changes = await listChanges(join(dir, "sub"), base, git("rev-parse", "HEAD"));
    expect(changes.files.map((f) => f.path)).toEqual(["\tlead.txt", "top.txt"]);
  });

  it("rejects a commit id that is not in the repository", async () => {
    const { dir, commit } = makeRepo();
    commit("one");

    expect((await refError(listChanges(dir, null, "0".repeat(40)))).code).toBe("unknown");
  });

  it("shows a merge commit's changes relative to its first parent", async () => {
    const { dir, git, commit } = makeRepo();
    commit("base");
    git("switch", "-q", "-c", "side");
    write(dir, "side.txt", "side\n");
    git("add", "side.txt");
    git("commit", "-q", "-m", "side");
    git("switch", "-q", "main");
    const main = commit("main");
    git("merge", "-q", "--no-ff", "-m", "merge", "side");
    const merge = git("rev-parse", "HEAD");

    const changes = await listChanges(dir, main, merge);
    expect(changes.files.map((f) => [f.path, f.status])).toEqual([["side.txt", "added"]]);
  });
});

describe("listCommits", () => {
  function history(authors: string[]) {
    const repo = makeRepo();
    const shas = authors.map((author, i) => {
      writeFileSync(join(repo.dir, "file.txt"), String(i));
      repo.git("add", "file.txt");
      repo.git("-c", `user.name=${author}`, "commit", "-q", "-m", `Change ${i}`, "-m", `Body mentions topic-${i % 2}`);
      return repo.git("rev-parse", "HEAD");
    });
    return { ...repo, shas };
  }

  const all = { skip: 0, limit: 50, message: "", author: "" };

  it("lists commits newest first with their summary", async () => {
    const { dir, shas } = history(["Ada", "Grace"]);

    const page = await listCommits(dir, all);
    expect(page.hasMore).toBe(false);
    expect(page.commits.map((c) => [c.sha, c.subject, c.author.name])).toEqual([
      [shas[1], "Change 1", "Grace"],
      [shas[0], "Change 0", "Ada"],
    ]);
    expect(page.commits[0].parents).toEqual([shas[0]]);
    expect(page.commits[1].parents).toEqual([]);
    expect(Date.parse(page.commits[0].date)).not.toBeNaN();
  });

  it("pages through long histories", async () => {
    const { dir, shas } = history(["a", "b", "c", "d", "e"]);

    const first = await listCommits(dir, { ...all, limit: 2 });
    const last = await listCommits(dir, { ...all, skip: 4, limit: 2 });
    expect(first.commits.map((c) => c.sha)).toEqual([shas[4], shas[3]]);
    expect(first.hasMore).toBe(true);
    expect(last.commits.map((c) => c.sha)).toEqual([shas[0]]);
    expect(last.hasMore).toBe(false);
  });

  it("filters by message text and author, case-insensitively and literally", async () => {
    const { dir } = history(["Ada Lovelace", "Grace Hopper", "Ada Lovelace", "Grace Hopper"]);

    const subjects = async (message: string, author: string) =>
      (await listCommits(dir, { ...all, message, author })).commits.map((c) => c.subject);
    expect(await subjects("", "grace")).toEqual(["Change 3", "Change 1"]);
    expect(await subjects("TOPIC-0", "")).toEqual(["Change 2", "Change 0"]);
    expect(await subjects("topic-0", "ada")).toEqual(["Change 2", "Change 0"]);
    expect(await subjects("topic-0", "grace")).toEqual([]);
    expect(await subjects("change .", "")).toEqual([]);
  });

  it("keeps commits apart whatever characters their subjects contain", async () => {
    const { dir, git, commit } = makeRepo();
    commit("plain");
    writeFileSync(join(dir, "file.txt"), "odd");
    git("add", "file.txt");
    git("commit", "-q", "-m", "odd \u001e subject");

    const page = await listCommits(dir, all);
    expect(page.commits.map((c) => c.subject)).toEqual(["odd \u001e subject", "plain"]);
  });

  it("returns an empty history for a repository without commits", async () => {
    const { dir } = makeRepo();

    expect(await listCommits(dir, all)).toEqual({ commits: [], hasMore: false });
  });
});
