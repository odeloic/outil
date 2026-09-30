import { useSyncExternalStore } from 'react'

export type DisplaySettings = {
  layout: 'unified' | 'split'
  wrap: boolean
  theme: 'system' | 'light' | 'dark'
}

const STORAGE_KEY = 'outil:display'
const DEFAULTS: DisplaySettings = { layout: 'unified', wrap: false, theme: 'system' }

function read(): DisplaySettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<DisplaySettings>
    return {
      layout: stored.layout === 'split' ? 'split' : 'unified',
      wrap: stored.wrap === true,
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : 'system',
    }
  } catch {
    return DEFAULTS
  }
}

let current = read()
const listeners = new Set<() => void>()

function applyTheme(theme: DisplaySettings['theme']) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

applyTheme(current.theme)

function save(settings: DisplaySettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    return
  }
}

export function updateDisplaySettings(change: Partial<DisplaySettings>) {
  current = { ...current, ...change }
  save(current)
  applyTheme(current.theme)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(subscribe, () => current)
}
