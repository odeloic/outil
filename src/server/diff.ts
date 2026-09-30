import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileDiff, FileDiffRequest, Hunk } from "../shared/api.ts";
import { assertCommits, emptyTree } from "./git.ts";

const exec = promisify(execFile);

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of patch.split("\n")) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const sign = line[0];
      const text = line.slice(1);
      if (sign === " ") {
        hunk.lines.push({ kind: "context", text });
        oldLeft--;
        newLeft--;
      } else if (sign === "-") {
        hunk.lines.push({ kind: "del", text });
        oldLeft--;
      } else if (sign === "+") {
        hunk.lines.push({ kind: "add", text });
        newLeft--;
      }
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (!match) continue;
    hunk = {
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
      header: match[5],
      lines: [],
    };
    oldLeft = hunk.oldLines;
    newLeft = hunk.newLines;
    hunks.push(hunk);
  }
  return hunks;
}

function pathspecs(path: string): string[] {
  return [`:(top,literal)${path}`, `:(top,exclude,literal)${path}/`];
}

function gitWithInput(cwd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    child.stdin?.end(input);
  });
}

async function blobSizes(cwd: string, specs: string[]): Promise<(number | null)[]> {
  const out = await gitWithInput(cwd, ["cat-file", "--batch-check=%(objecttype) %(objectsize)"], specs.map((s) => `${s}\n`).join(""));
  return out
    .trimEnd()
    .split("\n")
    .map((line) => {
      const [type, size] = line.split(" ");
      return type === "blob" ? Number(size) : null;
    });
}

async function blob(cwd: string, spec: string, bytes: number): Promise<string> {
  const { stdout } = await exec("git", ["cat-file", "blob", spec], { cwd, maxBuffer: bytes + 1024 });
  return stdout;
}

export async function getFileDiff(cwd: string, { base, head, path, oldPath, full }: FileDiffRequest): Promise<FileDiff> {
  await assertCommits(cwd, ...(base ? [base, head] : [head]));
  const from = base ?? (await emptyTree(cwd));
  const oldSpec = `${from}:${oldPath ?? path}`;
  const newSpec = `${head}:${path}`;
  const [oldBytes, newBytes] = await blobSizes(cwd, [oldSpec, newSpec]);
  const largest = Math.max(oldBytes ?? 0, newBytes ?? 0);
  if (!full && largest > MAX_FILE_BYTES) return { kind: "too-large", bytes: largest };

  const paths = oldPath && oldPath !== path ? [oldPath, path] : [path];
  const [{ stdout: patch }, oldText, newText] = await Promise.all([
    exec(
      "git",
      ["diff", "--no-ext-diff", "--no-textconv", "--no-relative", "--no-color", "-U3", "-M", from, head, "--", ...paths.flatMap(pathspecs)],
      { cwd, maxBuffer: 16 * largest + 1024 * 1024 },
    ),
    oldBytes === null ? null : blob(cwd, oldSpec, oldBytes),
    newBytes === null ? null : blob(cwd, newSpec, newBytes),
  ]);
  const firstHunk = patch.search(/^@@ /m);
  const header = firstHunk === -1 ? patch : patch.slice(0, firstHunk);
  if (/^(Binary files .* differ|GIT binary patch)$/m.test(header)) return { kind: "binary" };

  return { kind: "text", hunks: parsePatch(patch), oldText, newText };
}
