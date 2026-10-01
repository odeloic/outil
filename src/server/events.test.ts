import { describe, expect, it } from "vitest";
import type { Review, ReviewTarget, Run } from "../shared/api.ts";
import type { ReviewStore } from "./reviews.ts";
import { publishActivity, publishReview, publishingStore, subscribe } from "./events.ts";

let counter = 0;
function uniqueKey(): string {
  counter += 1;
  return `key-${counter}`;
}

function review(key: string, overrides: Partial<Review> = {}): Review {
  const target: ReviewTarget = { kind: "commit", sha: key };
  return { key, target, base: null, head: key, threads: [], runs: [], nextThread: 1, revision: 0, generation: "g1", ...overrides };
}

function runningRun(id: string): Run {
  return { id, agent: "claude", model: "haiku", state: "running", threadIds: [], startedAt: "d", endedAt: null, summary: null, error: null, owner: null };
}

describe("subscribe / publishReview", () => {
  it("delivers a published review only to subscribers of that key", () => {
    const key = uniqueKey();
    const seen: Review[] = [];
    const other: Review[] = [];
    const sub = subscribe(key, { onReview: (r) => seen.push(r), onActivity: () => {} });
    const otherSub = subscribe(uniqueKey(), { onReview: (r) => other.push(r), onActivity: () => {} });

    publishReview(key, review(key));

    expect(seen).toHaveLength(1);
    expect(other).toHaveLength(0);
    sub.unsubscribe();
    otherSub.unsubscribe();
  });

  it("does nothing when nobody is subscribed to that key", () => {
    const key = uniqueKey();
    expect(() => publishReview(key, review(key))).not.toThrow();
  });

  it("stops delivering after unsubscribe", () => {
    const key = uniqueKey();
    const seen: Review[] = [];
    const sub = subscribe(key, { onReview: (r) => seen.push(r), onActivity: () => {} });
    sub.unsubscribe();

    publishReview(key, review(key));

    expect(seen).toHaveLength(0);
  });
});

describe("publishActivity", () => {
  it("delivers activity to subscribers and buffers it for later subscribers", () => {
    const key = uniqueKey();
    const seen: string[] = [];
    const sub = subscribe(key, { onReview: () => {}, onActivity: (event) => seen.push(event.text) });

    publishActivity(key, { runId: "r1", text: "Reading a.ts", at: "d1" });
    publishActivity(key, { runId: "r1", text: "Searching for x", at: "d2" });

    expect(seen).toEqual(["Reading a.ts", "Searching for x"]);
    sub.unsubscribe();

    const late = subscribe(key, { onReview: () => {}, onActivity: () => {} });
    expect(late.activity.map((e) => e.text)).toEqual(["Reading a.ts", "Searching for x"]);
    late.unsubscribe();
    publishReview(key, review(key, { runs: [{ ...runningRun("r1"), state: "done", endedAt: "d" }] }));
  });

  it("keeps only the last 50 activity lines per run", () => {
    const key = uniqueKey();
    for (let i = 0; i < 60; i++) publishActivity(key, { runId: "r1", text: `line ${i}`, at: String(i) });

    const sub = subscribe(key, { onReview: () => {}, onActivity: () => {} });
    expect(sub.activity).toHaveLength(50);
    expect(sub.activity[0].text).toBe("line 10");
    expect(sub.activity.at(-1)!.text).toBe("line 59");
    sub.unsubscribe();
  });

  it("clears a run's buffered activity once a published review shows it is no longer running", () => {
    const key = uniqueKey();
    publishActivity(key, { runId: "r2", text: "Reading a.ts", at: "d1" });
    const running = review(key, { runs: [runningRun("r2")] });

    const sub = subscribe(key, { onReview: () => {}, onActivity: () => {} });
    expect(sub.activity.map((e) => e.runId)).toEqual(["r2"]);
    sub.unsubscribe();

    const lateDuring = subscribe(key, { onReview: () => {}, onActivity: () => {} });
    publishReview(key, running);
    expect(lateDuring.activity.map((e) => e.runId)).toEqual(["r2"]);
    lateDuring.unsubscribe();

    publishReview(key, { ...running, runs: [{ ...running.runs[0], state: "done", endedAt: "d" }] });

    const after = subscribe(key, { onReview: () => {}, onActivity: () => {} });
    expect(after.activity).toEqual([]);
    after.unsubscribe();
  });
});

describe("publishingStore", () => {
  function fakeStore(initial: Review): ReviewStore {
    let current = initial;
    return {
      async get() {
        return current;
      },
      async update(_t: ReviewTarget, fn: (review: Review) => Review | Promise<Review>) {
        current = await fn(current);
        return current;
      },
    };
  }

  it("publishes a review event for every successful update", async () => {
    const key = uniqueKey();
    const wrapped = publishingStore(fakeStore(review(key)));
    const seen: Review[] = [];
    const sub = subscribe(key, { onReview: (r) => seen.push(r), onActivity: () => {} });

    await wrapped.update({ kind: "commit", sha: key }, (r) => ({ ...r, revision: r.revision + 1 }));

    expect(seen).toHaveLength(1);
    expect(seen[0].revision).toBe(1);
    sub.unsubscribe();
  });

  it("leaves get() untouched", async () => {
    const key = uniqueKey();
    const wrapped = publishingStore(fakeStore(review(key)));
    await expect(wrapped.get({ kind: "commit", sha: key })).resolves.toEqual(review(key));
  });
});
