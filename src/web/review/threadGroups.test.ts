import { describe, expect, it } from 'vitest'
import type { Thread, ThreadAnchor } from '../../shared/api.ts'
import { anchorRange } from '../threads/anchorLabel.ts'
import { orderThreads } from './navigation.ts'
import { groupThreads, unresolvedCount } from './threadGroups.ts'

function thread(id: string, path: string, line: number, overrides: Partial<Thread> = {}, side: ThreadAnchor['side'] = 'new'): Thread {
  return {
    id,
    anchor: { path, side, startLine: line, endLine: line },
    messages: [{ id: `${id}-m`, author: 'reviewer', body: 'x', state: 'draft', createdAt: '2026-01-01T00:00:00Z' }],
    resolved: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Thread
}

const files = ['a.ts', 'b.ts']

describe('groupThreads', () => {
  const draft = thread('draft', 'b.ts', 3)
  const sent = thread('sent', 'a.ts', 9, { messages: [{ id: 's', author: 'reviewer', body: 'x', state: 'sent', createdAt: '2026-01-01T00:00:00Z' }] as Thread['messages'] })
  const done = thread('done', 'a.ts', 1, { resolved: true })

  it('keeps drafts in the open filter and puts only resolved threads in the fold', () => {
    const { groups, resolved } = groupThreads(files, [draft, sent, done], 'open')

    expect(groups.map(([path, list]) => [path, list.map((t) => t.id)])).toEqual([
      ['a.ts', ['sent']],
      ['b.ts', ['draft']],
    ])
    expect(resolved.map((t) => t.id)).toEqual(['done'])
  })

  it('shows resolved threads inline in diff order for the all filter, with no fold', () => {
    const { groups, resolved } = groupThreads(files, [draft, sent, done], 'all')

    expect(groups[0][1].map((t) => t.id)).toEqual(['done', 'sent'])
    expect(resolved).toEqual([])
  })

  it('is empty when there are no threads', () => {
    expect(groupThreads(files, [], 'open')).toEqual({ groups: [], resolved: [] })
  })
})

describe('unresolvedCount', () => {
  it('counts drafts and sent threads but not resolved ones', () => {
    expect(unresolvedCount([thread('a', 'a.ts', 1), thread('b', 'a.ts', 2, { resolved: true })])).toBe(1)
  })
})

describe('orderThreads', () => {
  it('orders by file position, then line, then old before new', () => {
    const ordered = orderThreads(files, [
      thread('b1', 'b.ts', 1),
      thread('a-new', 'a.ts', 5),
      thread('a-old', 'a.ts', 5, {}, 'old'),
      thread('a1', 'a.ts', 2),
    ])

    expect(ordered.map((t) => t.id)).toEqual(['a1', 'a-old', 'a-new', 'b1'])
  })
})

describe('anchorRange', () => {
  it('formats a single line, a range and the old side', () => {
    expect(anchorRange({ side: 'new', startLine: 59, endLine: 59 })).toBe('L59')
    expect(anchorRange({ side: 'new', startLine: 59, endLine: 60 })).toBe('L59–60')
    expect(anchorRange({ side: 'old', startLine: 3, endLine: 3 })).toBe('L3 old')
  })
})
