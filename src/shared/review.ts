import type { Review, Run, Thread } from "./api.ts"

export type ThreadStatus = "draft" | "sent" | "answered" | "resolved" | "failed"

export function threadStatus(thread: Thread, runs: Run[]): ThreadStatus {
  if (thread.resolved) return "resolved"
  const last = thread.messages[thread.messages.length - 1]
  if (!last) return "resolved"
  if (last.author === "reviewer" && last.state === "draft") return "draft"
  if (last.author === "agent") return "answered"
  const waiting = runs.some((run) => run.state === "running" && run.threadIds.includes(thread.id))
  return waiting ? "sent" : "failed"
}

export function draftCount(review: Review): number {
  return review.threads.reduce(
    (count, thread) =>
      count + thread.messages.filter((message) => message.author === "reviewer" && message.state === "draft").length,
    0,
  )
}
