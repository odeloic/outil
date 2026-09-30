import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefError } from "./errors.ts";
import { getCommit, resolveCommit } from "./git.ts";

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
