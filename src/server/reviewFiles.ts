import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, rm, stat, unlink, utimes } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { Review, ReviewTarget, Run, Thread, ThreadAnchor, ThreadMessage } from "../shared/api.ts";
import { emptyReview, enqueue, type ResolveTarget, type ReviewStore, type TargetResolution } from "./reviews.ts";

const exec = promisify(execFile);

const KEY_PATTERN = /^[0-9a-f]{40,64}(\.\.[0-9a-f]{40,64})?$/;
const LOCK_RETRY_MS = 30;
const LOCK_STALE_MS = 5000;
const LINE_SIDES = new Set(["old", "new"]);
const AGENT_IDS = new Set(["claude", "codex"]);
const RUN_STATES = new Set(["running", "done", "failed", "timed-out", "cancelled", "interrupted"]);

async function gitCommonDir(repoRoot: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot });
  const dir = stdout.trim();
  return isAbsolute(dir) ? dir : join(repoRoot, dir);
}

function reviewsDir(commonDir: string): string {
  return join(commonDir, "outil", "reviews");
}

function maxThreadNumber(threads: Thread[]): number {
  let max = 0;
  for (const thread of threads) {
    const match = /^t(\d+)$/.exec(thread.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function isThreadAnchor(value: unknown): value is ThreadAnchor {
  if (typeof value !== "object" || value === null) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.path === "string" &&
    LINE_SIDES.has(anchor.side as string) &&
    Number.isInteger(anchor.startLine) &&
    Number.isInteger(anchor.endLine)
  );
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string" || typeof message.body !== "string" || typeof message.createdAt !== "string") return false;
  if (message.author === "reviewer") return message.state === "draft" || message.state === "sent";
  if (message.author === "agent") {
    return (
      AGENT_IDS.has(message.agent as string) &&
      typeof message.model === "string" &&
      typeof message.runId === "string" &&
      typeof message.read === "boolean"
    );
  }
  return false;
}

function isThread(value: unknown): value is Thread {
  if (typeof value !== "object" || value === null) return false;
  const thread = value as Record<string, unknown>;
  return (
    typeof thread.id === "string" &&
    isThreadAnchor(thread.anchor) &&
    Array.isArray(thread.messages) &&
    thread.messages.every(isThreadMessage) &&
    typeof thread.resolved === "boolean" &&
    typeof thread.createdAt === "string"
  );
}

const RUN_ERROR_KINDS = new Set<string>(["missing", "agent", "invalid"]);

function isRunOwner(value: unknown): value is Run["owner"] {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.pid === "number" && typeof owner.instance === "string";
}

function isRun(value: unknown): value is Run {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.id === "string" &&
    AGENT_IDS.has(run.agent as string) &&
    typeof run.model === "string" &&
    RUN_STATES.has(run.state as string) &&
    Array.isArray(run.threadIds) &&
    run.threadIds.every((id) => typeof id === "string") &&
    isRunOwner(run.owner)
  );
}

function normalizeRun(run: Run): Run {
  const withEffort = typeof run.effort === "string" ? run : { ...run, effort: null };
  if (withEffort.errorKind === undefined || RUN_ERROR_KINDS.has(withEffort.errorKind)) return withEffort;
  const known = { ...withEffort };
  delete known.errorKind;
  return known;
}

type FileStat = { mtimeMs: number; size: number; ino: number };

async function statFile(file: string): Promise<FileStat | null> {
  try {
    const info = await stat(file);
    return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function sameStat(a: FileStat | null, b: FileStat | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino;
}

function normalize(resolution: TargetResolution, target: ReviewTarget, value: unknown): Review | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.key !== resolution.key) return null;
  if (!Array.isArray(raw.threads) || !raw.threads.every(isThread)) return null;
  const threads = raw.threads as Thread[];
  if (raw.runs !== undefined && (!Array.isArray(raw.runs) || !raw.runs.every(isRun))) return null;
  const runs = Array.isArray(raw.runs) ? (raw.runs as Run[]).map(normalizeRun) : [];
  if (raw.generation !== undefined && typeof raw.generation !== "string") return null;
  const generation = typeof raw.generation === "string" ? raw.generation : crypto.randomUUID();
  const nextThread = typeof raw.nextThread === "number" ? raw.nextThread : maxThreadNumber(threads) + 1;
  const revision = typeof raw.revision === "number" ? raw.revision : 0;
  return { key: resolution.key, target, base: resolution.base, head: resolution.head, threads, runs, nextThread, revision, generation };
}

type ReadResult = { review: Review; stat: FileStat | null };

async function readReview(file: string, resolution: TargetResolution, target: ReviewTarget): Promise<ReadResult> {
  const fileStat = await statFile(file);
  if (fileStat === null) return { review: emptyReview(target, resolution), stat: null };
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { review: emptyReview(target, resolution), stat: null };
    throw err;
  }
  try {
    const normalized = normalize(resolution, target, JSON.parse(text));
    if (!normalized) throw new Error("unexpected review shape");
    return { review: normalized, stat: fileStat };
  } catch (err) {
    console.warn(`outil: discarding corrupt review file ${file}: ${err instanceof Error ? err.message : String(err)}`);
    await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
    return { review: emptyReview(target, resolution), stat: null };
  }
}

async function persist(file: string, review: Review): Promise<FileStat> {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(review, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  const fileStat = await statFile(file);
  if (!fileStat) throw new Error(`outil: review file ${file} disappeared right after it was written.`);
  return fileStat;
}

async function lockAge(lockFile: string): Promise<number | null> {
  return stat(lockFile).then(
    (info) => Date.now() - info.mtimeMs,
    () => null,
  );
}

async function acquireLock(file: string): Promise<void> {
  const lockFile = `${file}.lock`;
  for (;;) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const age = await lockAge(lockFile);
      if (age !== null && age > LOCK_STALE_MS) {
        const claimed = `${lockFile}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`;
        if (await rename(lockFile, claimed).then(() => true, () => false)) await unlink(claimed).catch(() => {});
        continue;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LOCK_RETRY_MS));
    }
  }
}

function keepLockFresh(file: string): () => void {
  const lockFile = `${file}.lock`;
  const timer = setInterval(() => {
    const now = new Date();
    utimes(lockFile, now, now).catch(() => {});
  }, LOCK_STALE_MS / 5);
  timer.unref();
  return () => clearInterval(timer);
}

function releaseLock(file: string): Promise<void> {
  return unlink(`${file}.lock`).catch(() => {});
}

export function createFileStore(repoRoot: string, resolve: ResolveTarget): ReviewStore {
  const cache = new Map<string, ReadResult>();
  const queue = new Map<string, Promise<unknown>>();
  let dirPromise: Promise<string> | null = null;

  function dir(): Promise<string> {
    if (!dirPromise) dirPromise = gitCommonDir(repoRoot).then(reviewsDir);
    return dirPromise;
  }

  function assertValidKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid review key: ${key}`);
  }

  async function load(resolution: TargetResolution, target: ReviewTarget): Promise<Review> {
    assertValidKey(resolution.key);
    const file = join(await dir(), `${resolution.key}.json`);
    const cached = cache.get(resolution.key);
    if (cached) {
      const currentStat = await statFile(file);
      if (sameStat(cached.stat, currentStat)) return cached.review;
    }
    const result = await readReview(file, resolution, target);
    cache.set(resolution.key, result);
    return result.review;
  }

  return {
    async get(target) {
      const resolution = await resolve(target);
      return load(resolution, target);
    },
    update(target, fn) {
      return resolve(target).then((resolution) =>
        enqueue(queue, resolution.key, async () => {
          assertValidKey(resolution.key);
          const dirPath = await dir();
          await mkdir(dirPath, { recursive: true });
          const file = join(dirPath, `${resolution.key}.json`);
          await acquireLock(file);
          const stopRefreshing = keepLockFresh(file);
          try {
            const { review: current } = await readReview(file, resolution, target);
            const produced = await fn(current);
            const changed = JSON.stringify({ ...produced, revision: 0 }) !== JSON.stringify({ ...current, revision: 0 });
            const next = changed ? { ...produced, revision: current.revision + 1 } : current;
            const nextStat = changed ? await persist(file, next) : await statFile(file);
            cache.set(resolution.key, { review: next, stat: nextStat });
            return next;
          } finally {
            stopRefreshing();
            await releaseLock(file);
          }
        }),
      );
    },
  };
}
