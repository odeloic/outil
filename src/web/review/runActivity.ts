import { useCallback, useSyncExternalStore } from 'react'
import type { ActivityEvent } from '../../shared/api.ts'

const MAX_LINES = 20
const EMPTY: ActivityEvent[] = []

const lines = new Map<string, ActivityEvent[]>()
const listeners = new Map<string, Set<() => void>>()

function notify(runId: string) {
  listeners.get(runId)?.forEach((listener) => listener())
}

export function recordActivity(event: ActivityEvent) {
  const next = [...(lines.get(event.runId) ?? []), event].slice(-MAX_LINES)
  lines.set(event.runId, next)
  notify(event.runId)
}

export function clearRunActivity(runId: string) {
  if (!lines.has(runId)) return
  lines.delete(runId)
  notify(runId)
}

function subscribeTo(runId: string, listener: () => void) {
  let set = listeners.get(runId)
  if (!set) {
    set = new Set()
    listeners.set(runId, set)
  }
  set.add(listener)
  return () => set!.delete(listener)
}

export function useRunActivity(runId: string | null): ActivityEvent[] {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!runId) return () => {}
      return subscribeTo(runId, listener)
    },
    [runId],
  )
  const getSnapshot = useCallback(() => (runId ? (lines.get(runId) ?? EMPTY) : EMPTY), [runId])
  return useSyncExternalStore(subscribe, getSnapshot)
}
