import { describe, expect, it } from "vitest"
import type { AgentMessage, ReviewerMessage, Review, Run, Thread } from "./api.ts"
import { draftCount, isOpenThread, openThreadCount, threadStatus } from "./review.ts"

function reviewerMessage(overrides: Partial<ReviewerMessage> = {}): ReviewerMessage {
  return { id: "m1", author: "reviewer", body: "hi", createdAt: "2026-01-01T00:00:00Z", state: "draft", ...overrides }
}

function agentMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "m2",
    author: "agent",
    body: "ok",
    createdAt: "2026-01-01T00:00:00Z",
    agent: "claude",
    model: "sonnet",
    runId: "r1",
    read: false,
    ...overrides,
  }
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    anchor: { path: "a.ts", side: "new", startLine: 1, endLine: 1 },
    messages: [reviewerMessage()],
    resolved: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    agent: "claude",
    model: "sonnet",
    state: "running",
    threadIds: ["t1"],
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: null,
    summary: null,
    error: null,
    owner: null,
    ...overrides,
  }
}

describe("threadStatus", () => {
  it("is resolved when the thread is resolved, regardless of its messages", () => {
    expect(threadStatus(thread({ resolved: true }), [])).toBe("resolved")
  })

  it("is draft when the last message is a reviewer draft", () => {
    expect(threadStatus(thread({ messages: [reviewerMessage({ state: "draft" })] }), [])).toBe("draft")
  })

  it("is answered when the last message is from the agent", () => {
    const t = thread({ messages: [reviewerMessage({ state: "sent" }), agentMessage()] })
    expect(threadStatus(t, [])).toBe("answered")
  })

  it("is sent when the last message is a reviewer sent message and a run is still running for it", () => {
    const t = thread({ id: "t1", messages: [reviewerMessage({ state: "sent" })] })
    expect(threadStatus(t, [run({ state: "running", threadIds: ["t1"] })])).toBe("sent")
  })

  it("is failed when the last message is sent but no run is running for it", () => {
    const t = thread({ id: "t1", messages: [reviewerMessage({ state: "sent" })] })
    expect(threadStatus(t, [])).toBe("failed")
    expect(threadStatus(t, [run({ state: "done", threadIds: ["t1"] })])).toBe("failed")
    expect(threadStatus(t, [run({ state: "running", threadIds: ["t2"] })])).toBe("failed")
  })
})

describe("draftCount", () => {
  function review(threads: Thread[]): Review {
    return {
      key: "k",
      target: { kind: "commit", sha: "a".repeat(40) },
      base: null,
      head: "a".repeat(40),
      threads,
      runs: [],
      nextThread: 1,
      revision: 0,
      generation: "g1",
    }
  }

  it("counts only reviewer draft messages across all threads", () => {
    const threads = [
      thread({ id: "t1", messages: [reviewerMessage({ id: "m1", state: "draft" })] }),
      thread({
        id: "t2",
        messages: [reviewerMessage({ id: "m2", state: "sent" }), agentMessage({ id: "m3" }), reviewerMessage({ id: "m4", state: "draft" })],
      }),
    ]
    expect(draftCount(review(threads))).toBe(2)
  })

  it("is zero when there are no threads or no drafts", () => {
    expect(draftCount(review([]))).toBe(0)
    expect(draftCount(review([thread({ messages: [reviewerMessage({ state: "sent" })] })]))).toBe(0)
  })

  it("excludes drafts on resolved threads", () => {
    const threads = [
      thread({ id: "t1", resolved: true, messages: [reviewerMessage({ id: "m1", state: "draft" })] }),
      thread({ id: "t2", resolved: false, messages: [reviewerMessage({ id: "m2", state: "draft" })] }),
    ]
    expect(draftCount(review(threads))).toBe(1)
  })
})

describe("isOpenThread", () => {
  it("is false when the thread is resolved", () => {
    expect(isOpenThread(thread({ resolved: true, messages: [reviewerMessage({ state: "sent" })] }))).toBe(false)
  })

  it("is false for a thread with only a reviewer draft", () => {
    expect(isOpenThread(thread({ messages: [reviewerMessage({ state: "draft" })] }))).toBe(false)
  })

  it("is true for an unresolved thread with a sent reviewer message", () => {
    expect(isOpenThread(thread({ messages: [reviewerMessage({ state: "sent" })] }))).toBe(true)
  })

  it("is true for an unresolved thread with an agent reply, even if the last message is a new draft follow-up", () => {
    const t = thread({
      messages: [reviewerMessage({ id: "m1", state: "sent" }), agentMessage({ id: "m2" }), reviewerMessage({ id: "m3", state: "draft" })],
    })
    expect(isOpenThread(t)).toBe(true)
  })
})

describe("openThreadCount", () => {
  function review(threads: Thread[]): Review {
    return {
      key: "k",
      target: { kind: "commit", sha: "a".repeat(40) },
      base: null,
      head: "a".repeat(40),
      threads,
      runs: [],
      nextThread: 1,
      revision: 0,
      generation: "g1",
    }
  }

  it("counts unresolved threads with a sent message or an agent reply", () => {
    const threads = [
      thread({ id: "t1", messages: [reviewerMessage({ state: "draft" })] }),
      thread({ id: "t2", messages: [reviewerMessage({ state: "sent" })] }),
      thread({ id: "t3", resolved: true, messages: [reviewerMessage({ state: "sent" })] }),
      thread({ id: "t4", messages: [reviewerMessage({ id: "m1", state: "sent" }), agentMessage({ id: "m2" })] }),
    ]
    expect(openThreadCount(review(threads))).toBe(2)
  })
})
