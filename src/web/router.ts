import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

export function navigate(params: Record<string, string>, { replace = false } = {}) {
  const search = new URLSearchParams(params).toString()
  const url = search ? `?${search}` : window.location.pathname
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  listeners.forEach((listener) => listener())
}
