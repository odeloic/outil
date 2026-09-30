export type HeightStore = {
  subscribe: (id: string, listener: () => void) => () => void
  getHeight: (id: string) => number
  setHeight: (id: string, height: number) => void
}

export function createHeightStore(): HeightStore {
  const heights = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()

  return {
    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set()
      set.add(listener)
      listeners.set(id, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(id)
      }
    },
    getHeight(id) {
      return heights.get(id) ?? 0
    },
    setHeight(id, height) {
      if (heights.get(id) === height) return
      heights.set(id, height)
      for (const listener of listeners.get(id) ?? []) listener()
    },
  }
}
