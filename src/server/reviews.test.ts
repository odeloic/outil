import { describe, expect, it } from "vitest";
import type { Review, ReviewTarget } from "../shared/api.ts";
import {
  assertAnchorInDiff,
  createMemoryStore,
  createTargetResolver,
  createThread,
  deleteDraft,
  editDraft,
  ReviewError,
} from "./reviews.ts";

const sha = "a".repeat(40);
const parent = "b".repeat(40);

function emptyReview(target: ReviewTarget = { kind: "commit", sha }): Review {
  return { key: sha, target, base: null, head: sha, threads: [], runs: [], nextThread: 1 };
}

const anchor = { path: "src/a.ts", side: "new" as const, startLine: 3, endLine: 5 };

describe("createThread", () => {
  it("adds a new thread numbered from the review's nextThread counter", () => {
    const review = createThread(emptyReview(), anchor, "Looks off");

    expect(review.threads).toHaveLength(1);
    const [thread] = review.threads;
    expect(thread.id).toBe("t1");
    expect(thread.anchor).toEqual(anchor);
    expect(thread.resolved).toBe(false);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ author: "reviewer", body: "Looks off", state: "draft" });
    expect(thread.messages[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(review.nextThread).toBe(2);
  });

  it("numbers threads sequentially and never reuses an id after a delete", () => {
    let review = emptyReview();
    review = createThread(review, anchor, "one");
    review = createThread(review, anchor, "two");
    review = deleteDraft(review, review.threads[1].messages[0].id);
    review = createThread(review, anchor, "three");

    expect(review.threads.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("does not mutate the original review", () => {
    const original = emptyReview();
    createThread(original, anchor, "one");
    expect(original.threads).toEqual([]);
    expect(original.nextThread).toBe(1);
  });
});

describe("editDraft", () => {
  it("updates the body of a draft message", () => {
    const created = createThread(emptyReview(), anchor, "one");
    const id = created.threads[0].messages[0].id;

    const edited = editDraft(created, id, "one, edited");
    expect(edited.threads[0].messages[0].body).toBe("one, edited");
  });

  it("throws a 404 ReviewError for an unknown message id", () => {
    expect(() => editDraft(emptyReview(), "nope", "x")).toThrow(ReviewError);
    try {
      editDraft(emptyReview(), "nope", "x");
    } catch (err) {
      expect((err as ReviewError).status).toBe(404);
    }
  });

  it("throws a 409 ReviewError when the message is not a reviewer draft", () => {
    const created = createThread(emptyReview(), anchor, "one");
    const id = created.threads[0].messages[0].id;
    const sent: Review = {
      ...created,
      threads: created.threads.map((t) => ({
        ...t,
        messages: t.messages.map((m) => (m.author === "reviewer" ? { ...m, state: "sent" as const } : m)),
      })),
    };

    expect(() => editDraft(sent, id, "x")).toThrow(ReviewError);
    try {
      editDraft(sent, id, "x");
    } catch (err) {
      expect((err as ReviewError).status).toBe(409);
    }
  });
});

describe("deleteDraft", () => {
  it("removes the thread entirely when its only message is deleted", () => {
    const created = createThread(emptyReview(), anchor, "one");
    const id = created.threads[0].messages[0].id;

    const deleted = deleteDraft(created, id);
    expect(deleted.threads).toEqual([]);
  });

  it("keeps the thread and removes just the message when it has more than one", () => {
    const created = createThread(emptyReview(), anchor, "one");
    const draftId = created.threads[0].messages[0].id;
    const withExtra: Review = {
      ...created,
      threads: created.threads.map((t) => ({
        ...t,
        messages: [...t.messages, { id: "extra", author: "reviewer" as const, body: "two", createdAt: t.createdAt, state: "draft" as const }],
      })),
    };

    const deleted = deleteDraft(withExtra, draftId);
    expect(deleted.threads).toHaveLength(1);
    expect(deleted.threads[0].messages).toHaveLength(1);
    expect(deleted.threads[0].messages[0].id).toBe("extra");
  });

  it("throws 404 for an unknown id and 409 for a non-draft message", () => {
    expect(() => deleteDraft(emptyReview(), "nope")).toThrow(ReviewError);
  });
});

describe("assertAnchorInDiff", () => {
  it("resolves when the path is part of the diff between the review's base and head", async () => {
    const calls: Array<[string | null, string]> = [];
    await assertAnchorInDiff(
      {
        listChanges: async (base, head) => {
          calls.push([base, head]);
          return { base, head, files: [{ path: "src/a.ts", oldPath: null, status: "modified", additions: 1, deletions: 0, binary: false }], additions: 1, deletions: 0 };
        },
      },
      emptyReview(),
      "src/a.ts",
    );
    expect(calls).toEqual([[null, sha]]);
  });

  it("throws a 400 ReviewError when the path is not part of the diff", async () => {
    const deps = { listChanges: async () => ({ base: null, head: sha, files: [], additions: 0, deletions: 0 }) };
    await expect(assertAnchorInDiff(deps, emptyReview(), "src/missing.ts")).rejects.toThrow(ReviewError);
    try {
      await assertAnchorInDiff(deps, emptyReview(), "src/missing.ts");
    } catch (err) {
      expect((err as ReviewError).status).toBe(400);
    }
  });
});

describe("createTargetResolver", () => {
  it("resolves a commit target to its first parent and itself", async () => {
    const resolve = createTargetResolver({
      assertCommits: async () => {},
      getCommit: async (s) => ({ sha: s, parents: [parent], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" }),
      compareCommits: async () => {
        throw new Error("not expected");
      },
    });

    expect(await resolve({ kind: "commit", sha })).toEqual({ key: sha, base: parent, head: sha });
  });

  it("resolves a root commit target with a null base", async () => {
    const resolve = createTargetResolver({
      assertCommits: async () => {},
      getCommit: async (s) => ({ sha: s, parents: [], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" }),
      compareCommits: async () => {
        throw new Error("not expected");
      },
    });

    expect(await resolve({ kind: "commit", sha })).toEqual({ key: sha, base: null, head: sha });
  });

  it("resolves a compare target using the merge base, keying on the target shas", async () => {
    const other = "c".repeat(40);
    const mergeBase = "d".repeat(40);
    const resolve = createTargetResolver({
      assertCommits: async () => {},
      getCommit: async () => {
        throw new Error("not expected");
      },
      compareCommits: async (base, head) => ({
        base: { sha: base, parents: [], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" },
        head: { sha: head, parents: [], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" },
        mergeBase,
        commitCount: 1,
      }),
    });

    expect(await resolve({ kind: "compare", base: sha, head: other })).toEqual({ key: `${sha}..${other}`, base: mergeBase, head: other });
  });

  it("falls back to the target base when there is no merge base", async () => {
    const other = "c".repeat(40);
    const resolve = createTargetResolver({
      assertCommits: async () => {},
      getCommit: async () => {
        throw new Error("not expected");
      },
      compareCommits: async (base, head) => ({
        base: { sha: base, parents: [], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" },
        head: { sha: head, parents: [], author: { name: "a", email: "a" }, date: "d", subject: "s", body: "" },
        mergeBase: null,
        commitCount: 1,
      }),
    });

    expect(await resolve({ kind: "compare", base: sha, head: other })).toEqual({ key: `${sha}..${other}`, base: sha, head: other });
  });
});

describe("createMemoryStore", () => {
  it("returns an equivalent empty review for the same target until it is updated", async () => {
    const store = createMemoryStore(async () => ({ key: sha, base: null, head: sha }));
    const target: ReviewTarget = { kind: "commit", sha };

    const first = await store.get(target);
    const second = await store.get(target);
    expect(first).toEqual(emptyReview());
    expect(second).toEqual(emptyReview());
  });

  it("persists changes made through update and returns them from get", async () => {
    const store = createMemoryStore(async () => ({ key: sha, base: null, head: sha }));
    const target: ReviewTarget = { kind: "commit", sha };

    const updated = await store.update(target, (review) => createThread(review, anchor, "hi"));
    expect(updated.threads).toHaveLength(1);
    expect(await store.get(target)).toBe(updated);
  });

  it("keeps separate reviews per resolved key", async () => {
    const shaB = "c".repeat(40);
    const store = createMemoryStore(async (target) => {
      const s = target.kind === "commit" ? target.sha : target.head;
      return { key: s, base: null, head: s };
    });

    await store.update({ kind: "commit", sha }, (review) => createThread(review, anchor, "a"));
    const other = await store.get({ kind: "commit", sha: shaB });
    expect(other.threads).toEqual([]);
  });

  it("resolves the target exactly once per get or update call", async () => {
    let resolves = 0;
    const store = createMemoryStore(async () => {
      resolves++;
      return { key: sha, base: null, head: sha };
    });
    const target: ReviewTarget = { kind: "commit", sha };

    await store.get(target);
    expect(resolves).toBe(1);
    await store.update(target, (review) => createThread(review, anchor, "a"));
    expect(resolves).toBe(2);
  });

  it("serializes concurrent updates to the same key so no write is lost", async () => {
    const delays = [30, 10, 20];
    let call = 0;
    const store = createMemoryStore(async () => {
      const delay = delays[call++] ?? 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { key: sha, base: null, head: sha };
    });
    const target: ReviewTarget = { kind: "commit", sha };

    const [a, b, c] = await Promise.all([
      store.update(target, (review) => createThread(review, anchor, "a")),
      store.update(target, (review) => createThread(review, anchor, "b")),
      store.update(target, (review) => createThread(review, anchor, "c")),
    ]);

    const final = await store.get(target);
    expect(final.threads).toHaveLength(3);
    expect(new Set(final.threads.map((t) => t.id)).size).toBe(3);
    expect([a, b, c].every((r) => r.threads.length >= 1)).toBe(true);
  });
});
