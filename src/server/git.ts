import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommitDetails, RepoInfo } from "../shared/api.ts";
import { RefError } from "./errors.ts";

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

function tryGit(cwd: string, ...args: string[]): Promise<string | null> {
  return git(cwd, ...args).catch(() => null);
}

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const root = await git(cwd, "rev-parse", "--show-toplevel");
  // --verify --quiet exits non-zero with no output on an unborn HEAD
  const head = await git(root, "rev-parse", "--verify", "--quiet", "HEAD").catch(() => null);
  return { root, head };
}

export async function resolveCommit(cwd: string, ref: string): Promise<string> {
  if (ref.trim() === "") throw new RefError("unknown", "No commit reference was given.");

  // --end-of-options keeps refs such as "--all" from being read as flags
  const oid = await tryGit(cwd, "rev-parse", "--verify", "--quiet", "--end-of-options", ref);
  if (oid === null) throw await explainUnresolved(cwd, ref);

  const sha = await tryGit(cwd, "rev-parse", "--verify", "--quiet", `${oid}^{commit}`);
  if (sha === null) {
    const type = await git(cwd, "cat-file", "-t", `${oid}^{}`);
    throw new RefError("not-a-commit", `"${ref}" points to a ${type}, not a commit.`);
  }
  return sha;
}

async function explainUnresolved(cwd: string, ref: string): Promise<RefError> {
  if ((await git(cwd, "rev-list", "-n", "1", "--all")) === "") {
    return new RefError("empty-repo", "This repository has no commits yet. Make a first commit, then review it.");
  }
  // Ranges such as a..b fail --verify but still expand to their commits without it
  const revs = await tryGit(cwd, "rev-parse", "--revs-only", "--end-of-options", ref);
  if (revs) {
    return new RefError("not-single", `"${ref}" names several commits. Give a single commit to review.`);
  }
  if (/^[0-9a-f]{4,63}$/i.test(ref)) {
    const matches = await tryGit(cwd, "rev-parse", `--disambiguate=${ref}`);
    if (matches && matches.split("\n").length > 1) {
      return new RefError("ambiguous", `"${ref}" matches more than one object. Use more characters of the commit ID.`);
    }
  }
  return new RefError("unknown", `"${ref}" does not match any commit, branch, or tag in this repository.`);
}

export async function getCommit(cwd: string, sha: string): Promise<CommitDetails> {
  const format = ["%H", "%P", "%an", "%ae", "%aI", "%B"].join("%x00");
  const out = await git(cwd, "show", "-s", "--no-show-signature", `--format=${format}`, "--end-of-options", sha);
  const [hash, parents, name, email, date, message] = out.split("\0");
  const [subject, ...rest] = message.split("\n");
  return {
    sha: hash,
    parents: parents === "" ? [] : parents.split(" "),
    author: { name, email },
    date,
    subject,
    body: rest.join("\n").replace(/^\s*\n/, "").trimEnd(),
  };
}
