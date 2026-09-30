import { describe, expect, it } from 'vitest'
import type { Row } from './rows.ts'
import { toSplitRows } from './split.ts'

const context = (oldNo: number, newNo: number, text: string): Row => ({ type: 'line', kind: 'context', oldNo, newNo, text })
const del = (oldNo: number, text: string): Row => ({ type: 'line', kind: 'del', oldNo, newNo: null, text })
const add = (newNo: number, text: string): Row => ({ type: 'line', kind: 'add', oldNo: null, newNo, text })

describe('toSplitRows', () => {
  it('shows context lines on both sides', () => {
    expect(toSplitRows([context(3, 4, 'x')])).toEqual([
      { type: 'split', left: { no: 3, text: 'x', kind: 'context' }, right: { no: 4, text: 'x', kind: 'context' } },
    ])
  })

  it('pairs removed lines with the added lines that replace them, leaving the shorter side empty', () => {
    const rows = toSplitRows([del(1, 'a'), del(2, 'b'), add(1, 'A'), context(3, 2, 'c')])
    expect(rows).toEqual([
      { type: 'split', left: { no: 1, text: 'a', kind: 'del' }, right: { no: 1, text: 'A', kind: 'add' } },
      { type: 'split', left: { no: 2, text: 'b', kind: 'del' }, right: null },
      { type: 'split', left: { no: 3, text: 'c', kind: 'context' }, right: { no: 2, text: 'c', kind: 'context' } },
    ])
  })

  it('keeps an added file entirely on the right and a deleted file entirely on the left', () => {
    expect(toSplitRows([add(1, 'a'), add(2, 'b')]).map((r) => r.type === 'split' && [r.left, r.right?.no])).toEqual([
      [null, 1],
      [null, 2],
    ])
    expect(toSplitRows([del(1, 'a')]).map((r) => r.type === 'split' && [r.left?.no, r.right])).toEqual([[1, null]])
  })

  it('does not pair an addition with a removal that comes after it', () => {
    const rows = toSplitRows([add(1, 'new'), del(1, 'old')])
    expect(rows.map((r) => r.type === 'split' && [r.left?.no ?? null, r.right?.no ?? null])).toEqual([
      [null, 1],
      [1, null],
    ])
  })

  it('passes gaps through unchanged', () => {
    const gap: Row = { type: 'gap', index: 0, hidden: 5, canExpandUp: true, canExpandDown: false, header: 'fn' }
    expect(toSplitRows([gap, del(6, 'a'), add(6, 'b')])[0]).toBe(gap)
  })
})
