import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoInfo } from "../shared/api.ts";

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const root = await git(cwd, "rev-parse", "--show-toplevel");
  // --verify --quiet exits non-zero with no output on an unborn HEAD
  const head = await git(root, "rev-parse", "--verify", "--quiet", "HEAD").catch(() => null);
  return { root, head };
}
