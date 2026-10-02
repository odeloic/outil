import type { Review, Run, Thread } from "./api.ts"

export type ThreadStatus = "draft" | "sent" | "answered" | "resolved" | "failed"

export function threadStatus(thread: Thread, runs: Run[]): ThreadStatus {
  if (thread.resolved) return "resolved"
  const last = thread.messages[thread.messages.length - 1]
  if (!last) return "resolved"
  if (last.author === "reviewer" && last.state === "draft") return "draft"
  if (last.author === "agent") return "answered"
  const waiting = runs.some((run) => (run.state === "queued" || run.state === "running") && run.threadIds.includes(thread.id))
  return waiting ? "sent" : "failed"
}

export function draftCount(review: Review): number {
  return review.threads.reduce(
    (count, thread) =>
      thread.resolved
        ? count
        : count + thread.messages.filter((message) => message.author === "reviewer" && message.state === "draft").length,
    0,
  )
}

export function isOpenThread(thread: Thread): boolean {
  if (thread.resolved) return false
  return thread.messages.some((message) => (message.author === "reviewer" && message.state === "sent") || message.author === "agent")
}

export function openThreadCount(review: Review): number {
  return review.threads.filter(isOpenThread).length
}
