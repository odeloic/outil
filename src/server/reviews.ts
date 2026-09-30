import type { ChangeSet, Comparison, CommitDetails, Review, ReviewTarget, Thread, ThreadAnchor } from "../shared/api.ts";

export class ReviewError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export type ReviewStore = {
  get(target: ReviewTarget): Promise<Review>;
  update(target: ReviewTarget, fn: (review: Review) => Review | Promise<Review>): Promise<Review>;
};

export type TargetResolution = { key: string; base: string | null; head: string };

export type ResolveTarget = (target: ReviewTarget) => Promise<TargetResolution>;

export type ResolveDeps = {
  assertCommits: (...shas: string[]) => Promise<void>;
  getCommit: (sha: string) => Promise<CommitDetails>;
  compareCommits: (base: string, head: string) => Promise<Comparison>;
};

export function createTargetResolver({ assertCommits, getCommit, compareCommits }: ResolveDeps): ResolveTarget {
  return async (target) => {
    if (target.kind === "commit") {
      await assertCommits(target.sha);
      const commit = await getCommit(target.sha);
      return { key: commit.sha, base: commit.parents[0] ?? null, head: commit.sha };
    }
    await assertCommits(target.base, target.head);
    const comparison = await compareCommits(target.base, target.head);
    return { key: `${target.base}..${target.head}`, base: comparison.mergeBase ?? comparison.base.sha, head: comparison.head.sha };
  };
}

function emptyReview(target: ReviewTarget, resolution: TargetResolution): Review {
  return { key: resolution.key, target, base: resolution.base, head: resolution.head, threads: [], runs: [], nextThread: 1 };
}

function enqueue<T>(queue: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
  const tail = queue.get(key) ?? Promise.resolve();
  const run = tail.then(task, task);
  queue.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function createMemoryStore(resolve: ResolveTarget): ReviewStore {
  const reviews = new Map<string, Review>();
  const queue = new Map<string, Promise<unknown>>();

  return {
    async get(target) {
      const resolution = await resolve(target);
      return reviews.get(resolution.key) ?? emptyReview(target, resolution);
    },
    update(target, fn) {
      return resolve(target).then((resolution) =>
        enqueue(queue, resolution.key, async () => {
          const current = reviews.get(resolution.key) ?? emptyReview(target, resolution);
          const next = await fn(current);
          reviews.set(resolution.key, next);
          return next;
        }),
      );
    },
  };
}

export function createThread(review: Review, anchor: ThreadAnchor, body: string): Review {
  const message = {
    id: crypto.randomUUID(),
    author: "reviewer" as const,
    body,
    createdAt: new Date().toISOString(),
    state: "draft" as const,
  };
  const thread: Thread = {
    id: `t${review.nextThread}`,
    anchor,
    messages: [message],
    resolved: false,
    createdAt: message.createdAt,
  };
  return { ...review, threads: [...review.threads, thread], nextThread: review.nextThread + 1 };
}

function findDraft(review: Review, id: string): Thread {
  for (const thread of review.threads) {
    const message = thread.messages.find((candidate) => candidate.id === id);
    if (!message) continue;
    if (message.author !== "reviewer" || message.state !== "draft") {
      throw new ReviewError(409, "Only a draft reviewer message can be edited or deleted.");
    }
    return thread;
  }
  throw new ReviewError(404, `No message with id ${id}.`);
}

export function editDraft(review: Review, id: string, body: string): Review {
  const thread = findDraft(review, id);
  return {
    ...review,
    threads: review.threads.map((candidate) =>
      candidate.id !== thread.id
        ? candidate
        : { ...candidate, messages: candidate.messages.map((message) => (message.id === id ? { ...message, body } : message)) },
    ),
  };
}

export function deleteDraft(review: Review, id: string): Review {
  const thread = findDraft(review, id);
  if (thread.messages.length === 1) {
    return { ...review, threads: review.threads.filter((candidate) => candidate.id !== thread.id) };
  }
  return {
    ...review,
    threads: review.threads.map((candidate) =>
      candidate.id !== thread.id ? candidate : { ...candidate, messages: candidate.messages.filter((message) => message.id !== id) },
    ),
  };
}

export type AnchorCheckDeps = { listChanges: (base: string | null, head: string) => Promise<ChangeSet> };

export async function assertAnchorInDiff({ listChanges }: AnchorCheckDeps, review: Review, path: string): Promise<void> {
  const changes = await listChanges(review.base, review.head);
  if (!changes.files.some((file) => file.path === path)) {
    throw new ReviewError(400, `"${path}" is not part of this diff.`);
  }
}
