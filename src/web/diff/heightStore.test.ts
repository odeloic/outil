import { describe, expect, it, vi } from 'vitest'
import { createHeightStore } from './heightStore.ts'

describe('createHeightStore', () => {
  it('reports 0 for an id with no recorded height', () => {
    const store = createHeightStore()
    expect(store.getHeight('t1')).toBe(0)
  })

  it('notifies only listeners subscribed to the id that changed', () => {
    const store = createHeightStore()
    const t1Listener = vi.fn()
    const t2Listener = vi.fn()
    store.subscribe('t1', t1Listener)
    store.subscribe('t2', t2Listener)

    store.setHeight('t1', 40)

    expect(store.getHeight('t1')).toBe(40)
    expect(t1Listener).toHaveBeenCalledTimes(1)
    expect(t2Listener).not.toHaveBeenCalled()
  })

  it('does not notify when the height is unchanged', () => {
    const store = createHeightStore()
    store.setHeight('t1', 40)
    const listener = vi.fn()
    store.subscribe('t1', listener)

    store.setHeight('t1', 40)

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const store = createHeightStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe('t1', listener)
    unsubscribe()

    store.setHeight('t1', 40)

    expect(listener).not.toHaveBeenCalled()
  })
})
