import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function checkoutTree(repoRoot: string, sha: string, dir: string): Promise<void> {
  const indexDir = await mkdtemp(join(tmpdir(), "outil-index-"));
  const indexFile = join(indexDir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    await exec("git", ["read-tree", "--end-of-options", sha], { cwd: repoRoot, env });
    await exec("git", ["checkout-index", "-a", "-f", `--prefix=${dir}/`], { cwd: repoRoot, env });
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

export async function withSnapshot<T>(repoRoot: string, sha: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "outil-snapshot-")));
  try {
    await checkoutTree(repoRoot, sha, dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
