const BACKOFF_MS = [1000, 2000, 5000]

export function nextBackoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}
