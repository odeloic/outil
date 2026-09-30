import { describe, expect, it } from "vitest";
import { parseAnswer } from "./answer.ts";
import { AgentRunError } from "./errors.ts";

describe("parseAnswer", () => {
  const sent = ["t1", "t2", "t3"];

  it("keeps replies for threads that were sent", () => {
    const raw = { summary: "done", replies: [{ threadId: "t1", body: "ok" }, { threadId: "t2", body: "sure" }] };

    const answer = parseAnswer(raw, sent);

    expect(answer.summary).toBe("done");
    expect(answer.replies).toEqual([{ threadId: "t1", body: "ok" }, { threadId: "t2", body: "sure" }]);
    expect(answer.unanswered).toEqual(["t3"]);
  });

  it("drops a reply for a thread that was not sent", () => {
    const raw = { summary: "done", replies: [{ threadId: "t1", body: "ok" }, { threadId: "ghost", body: "nope" }] };

    const answer = parseAnswer(raw, sent);

    expect(answer.replies).toEqual([{ threadId: "t1", body: "ok" }]);
  });

  it("reports a sent thread with no reply as unanswered", () => {
    const raw = { summary: "done", replies: [{ threadId: "t1", body: "ok" }] };

    const answer = parseAnswer(raw, sent);

    expect(answer.unanswered).toEqual(["t2", "t3"]);
  });

  it("treats an empty or whitespace-only body as no reply", () => {
    const raw = { summary: "done", replies: [{ threadId: "t1", body: "   " }, { threadId: "t2", body: "" }] };

    const answer = parseAnswer(raw, sent);

    expect(answer.replies).toEqual([]);
    expect(answer.unanswered).toEqual(["t1", "t2", "t3"]);
  });

  it("keeps the first non-empty reply for a duplicate thread id", () => {
    const raw = {
      summary: "done",
      replies: [{ threadId: "t1", body: "" }, { threadId: "t1", body: "first" }, { threadId: "t1", body: "second" }],
    };

    const answer = parseAnswer(raw, sent);

    expect(answer.replies).toEqual([{ threadId: "t1", body: "first" }]);
  });

  it("rejects an answer that is not an object", () => {
    for (const raw of [null, "hello", 42, ["a"]]) {
      expect(() => parseAnswer(raw, sent)).toThrow(AgentRunError);
    }
  });

  it("rejects an answer missing a string summary", () => {
    expect(() => parseAnswer({ replies: [] }, sent)).toThrow(AgentRunError);
    expect(() => parseAnswer({ summary: 1, replies: [] }, sent)).toThrow(AgentRunError);
  });

  it("rejects an answer whose replies are not shaped correctly", () => {
    expect(() => parseAnswer({ summary: "s", replies: "nope" }, sent)).toThrow(AgentRunError);
    expect(() => parseAnswer({ summary: "s", replies: [{ threadId: "t1" }] }, sent)).toThrow(AgentRunError);
    expect(() => parseAnswer({ summary: "s", replies: [{ body: "no id" }] }, sent)).toThrow(AgentRunError);
  });

  it("throws with kind invalid", () => {
    expect.assertions(2);
    try {
      parseAnswer(null, sent);
    } catch (err) {
      expect(err).toBeInstanceOf(AgentRunError);
      expect((err as AgentRunError).kind).toBe("invalid");
    }
  });
});
