import type { ActivityEvent, Review } from "../shared/api.ts";
import type { ReviewStore } from "./reviews.ts";

export type EventHandlers = {
  onReview: (review: Review) => void;
  onActivity: (event: ActivityEvent) => void;
};

export type Subscription = {
  activity: ActivityEvent[];
  unsubscribe: () => void;
};

const MAX_ACTIVITY = 50;

type Hub = {
  subscribers: Set<EventHandlers>;
  activity: Map<string, ActivityEvent[]>;
  seq: Map<string, number>;
};

const hubs = new Map<string, Hub>();

function existingHub(key: string): Hub | undefined {
  return hubs.get(key);
}

function hub(key: string): Hub {
  let found = hubs.get(key);
  if (!found) {
    found = { subscribers: new Set(), activity: new Map(), seq: new Map() };
    hubs.set(key, found);
  }
  return found;
}

function pruneIfEmpty(key: string, found: Hub): void {
  if (found.subscribers.size === 0 && found.activity.size === 0) hubs.delete(key);
}

export function publishReview(key: string, review: Review): void {
  const found = existingHub(key);
  if (!found) return;
  for (const run of review.runs) {
    if (run.state !== "running") {
      found.activity.delete(run.id);
      found.seq.delete(run.id);
    }
  }
  for (const subscriber of found.subscribers) subscriber.onReview(review);
  pruneIfEmpty(key, found);
}

export function publishActivity(key: string, event: Omit<ActivityEvent, "seq">): void {
  const found = hub(key);
  const seq = (found.seq.get(event.runId) ?? 0) + 1;
  found.seq.set(event.runId, seq);
  const withSeq: ActivityEvent = { ...event, seq };
  const lines = found.activity.get(event.runId) ?? [];
  lines.push(withSeq);
  found.activity.set(event.runId, lines.length > MAX_ACTIVITY ? lines.slice(-MAX_ACTIVITY) : lines);
  for (const subscriber of found.subscribers) subscriber.onActivity(withSeq);
}

export function subscribe(key: string, handlers: EventHandlers): Subscription {
  const found = hub(key);
  found.subscribers.add(handlers);
  const activity = [...found.activity.values()].flat();
  return {
    activity,
    unsubscribe: () => {
      found.subscribers.delete(handlers);
      pruneIfEmpty(key, found);
    },
  };
}

export function publishingStore(store: ReviewStore): ReviewStore {
  return {
    get: (target) => store.get(target),
    async update(target, fn) {
      const review = await store.update(target, fn);
      publishReview(review.key, review);
      return review;
    },
  };
}
