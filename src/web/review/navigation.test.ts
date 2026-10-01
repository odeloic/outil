import { describe, expect, it } from 'vitest'
import type { ReviewerMessage, Thread } from '../../shared/api.ts'
import { adjacentOpenThread, orderOpenThreads } from './navigation.ts'

function sentMessage(overrides: Partial<ReviewerMessage> = {}): ReviewerMessage {
  return { id: 'm1', author: 'reviewer', body: 'hi', createdAt: 'd', state: 'sent', ...overrides }
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    anchor: { path: 'a.ts', side: 'new', startLine: 1, endLine: 1 },
    messages: [sentMessage()],
    resolved: false,
    createdAt: 'd',
    ...overrides,
  }
}

describe('orderOpenThreads', () => {
  it('orders threads by file index first', () => {
    const threads = [
      thread({ id: 't1', anchor: { path: 'b.ts', side: 'new', startLine: 1, endLine: 1 } }),
      thread({ id: 't2', anchor: { path: 'a.ts', side: 'new', startLine: 1, endLine: 1 } }),
    ]
    const ordered = orderOpenThreads(['a.ts', 'b.ts'], threads)
    expect(ordered.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('orders threads within the same file by anchor end line', () => {
    const threads = [
      thread({ id: 't1', anchor: { path: 'a.ts', side: 'new', startLine: 10, endLine: 10 } }),
      thread({ id: 't2', anchor: { path: 'a.ts', side: 'new', startLine: 2, endLine: 2 } }),
    ]
    const ordered = orderOpenThreads(['a.ts'], threads)
    expect(ordered.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('puts the old side before the new side on a tied end line', () => {
    const threads = [
      thread({ id: 't1', anchor: { path: 'a.ts', side: 'new', startLine: 5, endLine: 5 } }),
      thread({ id: 't2', anchor: { path: 'a.ts', side: 'old', startLine: 5, endLine: 5 } }),
    ]
    const ordered = orderOpenThreads(['a.ts'], threads)
    expect(ordered.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('excludes resolved threads and pure drafts', () => {
    const threads = [
      thread({ id: 't1', resolved: true }),
      thread({ id: 't2', messages: [sentMessage({ state: 'draft' })] }),
      thread({ id: 't3' }),
    ]
    const ordered = orderOpenThreads(['a.ts'], threads)
    expect(ordered.map((t) => t.id)).toEqual(['t3'])
  })
})

describe('adjacentOpenThread', () => {
  const at = (id: string, path: string, line: number): Thread =>
    ({ id, anchor: { path, side: 'new', startLine: line, endLine: line }, messages: [], resolved: false, createdAt: 'x' }) as Thread
  const paths = ['a.ts', 'b.ts']
  const one = at('t1', 'a.ts', 5)
  const two = at('t2', 'a.ts', 9)
  const three = at('t3', 'b.ts', 2)

  it('starts at the first or last thread', () => {
    expect(adjacentOpenThread(paths, [one, two, three], null, 1)).toBe(one)
    expect(adjacentOpenThread(paths, [one, two, three], null, -1)).toBe(three)
  })

  it('continues from where the current thread was after it left the list', () => {
    expect(adjacentOpenThread(paths, [one, three], two, 1)).toBe(three)
    expect(adjacentOpenThread(paths, [one, three], two, -1)).toBe(one)
  })

  it('wraps around at either end', () => {
    expect(adjacentOpenThread(paths, [one, two, three], three, 1)).toBe(one)
    expect(adjacentOpenThread(paths, [one, two], three, 1)).toBe(one)
  })
})
