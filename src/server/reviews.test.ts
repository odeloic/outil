import { describe, expect, it } from "vitest";
import type { Review, ReviewTarget } from "../shared/api.ts";
import {
  assertAnchorInDiff,
  createTargetResolver,
  createThread,
  deleteDraft,
  editDraft,
  markThreadRead,
  ReviewError,
} from "./reviews.ts";

const sha = "a".repeat(40);
const parent = "b".repeat(40);

function emptyReview(target: ReviewTarget = { kind: "commit", sha }): Review {
  return { key: sha, target, base: null, head: sha, threads: [], runs: [], nextThread: 1, revision: 0, generation: "g1" };
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

describe("markThreadRead", () => {
  function withAgentMessages(review: Review, threadId: string): Review {
    return {
      ...review,
      threads: review.threads.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              messages: [
                ...t.messages,
                { id: "a1", author: "agent" as const, body: "reply", createdAt: "d", agent: "claude" as const, model: "haiku", runId: "r1", read: false },
              ],
            },
      ),
    };
  }

  it("marks every unread agent message in the thread as read", () => {
    const created = createThread(emptyReview(), anchor, "one");
    const withAgent = withAgentMessages(created, "t1");

    const read = markThreadRead(withAgent, "t1");
    const agentMessage = read.threads[0].messages.find((m) => m.author === "agent");
    expect(agentMessage).toMatchObject({ read: true });
  });

  it("does not touch other threads", () => {
    let review = createThread(emptyReview(), anchor, "one");
    review = createThread(review, anchor, "two");
    review = withAgentMessages(review, "t1");
    review = withAgentMessages(review, "t2");

    const read = markThreadRead(review, "t1");
    const t2Agent = read.threads[1].messages.find((m) => m.author === "agent");
    expect(t2Agent).toMatchObject({ read: false });
  });

  it("throws a 404 ReviewError for an unknown thread id", () => {
    expect(() => markThreadRead(emptyReview(), "nope")).toThrow(ReviewError);
    try {
      markThreadRead(emptyReview(), "nope");
    } catch (err) {
      expect((err as ReviewError).status).toBe(404);
    }
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
