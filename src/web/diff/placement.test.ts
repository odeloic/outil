import { describe, expect, it } from 'vitest'
import { findAnchorRow, type PlacementRow } from './placement.ts'

const context = (oldNo: number, newNo: number): PlacementRow => ({ type: 'line', kind: 'context', oldNo, newNo, text: `c${newNo}` })
const del = (oldNo: number): PlacementRow => ({ type: 'line', kind: 'del', oldNo, newNo: null, text: `d${oldNo}` })
const add = (newNo: number): PlacementRow => ({ type: 'line', kind: 'add', oldNo: null, newNo, text: `a${newNo}` })
const gap = (index: number): PlacementRow => ({ type: 'gap', index, hidden: 3, canExpandUp: true, canExpandDown: true, header: '' })

describe('findAnchorRow on unified rows', () => {
  it('finds a context row on the new side', () => {
    const rows = [context(1, 1), context(2, 2), context(3, 3)]
    expect(findAnchorRow(rows, 'new', 2)).toBe(1)
  })

  it('finds a del row on the old side', () => {
    const rows = [context(1, 1), del(2), add(2)]
    expect(findAnchorRow(rows, 'old', 2)).toBe(1)
  })

  it('finds an add row on the new side', () => {
    const rows = [context(1, 1), del(2), add(2)]
    expect(findAnchorRow(rows, 'new', 2)).toBe(2)
  })

  it('prefers a del/add row over a context row for the same line number', () => {
    const rows = [context(5, 5), del(5)]
    expect(findAnchorRow(rows, 'old', 5)).toBe(1)
  })

  it('ignores gap rows', () => {
    const rows = [gap(0), context(1, 1)]
    expect(findAnchorRow(rows, 'new', 1)).toBe(1)
  })

  it('returns -1 when no row matches', () => {
    const rows = [context(1, 1)]
    expect(findAnchorRow(rows, 'new', 99)).toBe(-1)
  })
})

describe('findAnchorRow on split rows', () => {
  it('matches the left half for an old-side anchor and the right half for a new-side anchor', () => {
    const rows: PlacementRow[] = [
      { type: 'split', left: { no: 1, text: 'a', kind: 'context' }, right: { no: 1, text: 'a', kind: 'context' } },
      { type: 'split', left: { no: 2, text: 'old', kind: 'del' }, right: { no: 2, text: 'new', kind: 'add' } },
    ]
    expect(findAnchorRow(rows, 'old', 2)).toBe(1)
    expect(findAnchorRow(rows, 'new', 2)).toBe(1)
  })

  it('does not match a null half', () => {
    const rows: PlacementRow[] = [{ type: 'split', left: null, right: { no: 5, text: 'x', kind: 'add' } }]
    expect(findAnchorRow(rows, 'old', 5)).toBe(-1)
    expect(findAnchorRow(rows, 'new', 5)).toBe(0)
  })
})
