import { useCallback, useSyncExternalStore } from 'react'

const PREFIX = 'outil:viewed:'
const listeners = new Set<() => void>()
const cache = new Map<string, ReadonlySet<string>>()

function load(reviewKey: string): ReadonlySet<string> {
  const cached = cache.get(reviewKey)
  if (cached) return cached
  let paths: ReadonlySet<string> = new Set()
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PREFIX + reviewKey) ?? '[]')
    if (Array.isArray(stored)) paths = new Set(stored.filter((p): p is string => typeof p === 'string'))
  } catch {
    paths = new Set()
  }
  cache.set(reviewKey, paths)
  return paths
}

function persist(reviewKey: string, paths: ReadonlySet<string>) {
  try {
    if (paths.size === 0) localStorage.removeItem(PREFIX + reviewKey)
    else localStorage.setItem(PREFIX + reviewKey, JSON.stringify([...paths]))
  } catch {
    return
  }
}

function save(reviewKey: string, paths: ReadonlySet<string>) {
  cache.set(reviewKey, paths)
  persist(reviewKey, paths)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useViewedFiles(reviewKey: string) {
  const viewed = useSyncExternalStore(subscribe, () => load(reviewKey))
  const setViewed = useCallback(
    (path: string, value: boolean) => {
      const next = new Set(load(reviewKey))
      if (value) next.add(path)
      else next.delete(path)
      save(reviewKey, next)
    },
    [reviewKey],
  )
  return [viewed, setViewed] as const
}
