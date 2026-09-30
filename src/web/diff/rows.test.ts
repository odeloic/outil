import { describe, expect, it } from 'vitest'
import type { Hunk } from '../../shared/api.ts'
import { buildRows, splitLines, type Expansion, type GapRow, type LineRow, type Row } from './rows.ts'

function isGap(row: Row): row is GapRow {
  return row.type === 'gap'
}

function isLine(row: Row): row is LineRow {
  return row.type === 'line'
}

describe('splitLines', () => {
  it('returns no lines for null or empty text', () => {
    expect(splitLines(null)).toEqual([])
    expect(splitLines('')).toEqual([])
  })

  it('does not produce an extra line for a trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
  })

  it('keeps the last line when there is no trailing newline', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a')).toEqual(['a'])
  })

  it('strips CRLF line endings', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
  })
})

const newLines = Array.from({ length: 25 }, (_, i) => `L${i + 1}`)

const hunks: Hunk[] = [
  {
    oldStart: 5,
    oldLines: 3,
    newStart: 5,
    newLines: 4,
    header: 'hunk1 header',
    lines: [
      { kind: 'context', text: 'line5' },
      { kind: 'del', text: 'old6' },
      { kind: 'add', text: 'new6a' },
      { kind: 'add', text: 'new6b' },
      { kind: 'context', text: 'line8' },
    ],
  },
  {
    oldStart: 15,
    oldLines: 3,
    newStart: 16,
    newLines: 2,
    header: 'hunk2 header',
    lines: [
      { kind: 'context', text: 'c15' },
      { kind: 'del', text: 'd16' },
      { kind: 'add', text: 'a17' },
      { kind: 'del', text: 'd17b' },
    ],
  },
]

const newCount = 25

describe('buildRows gaps', () => {
  it('produces a gap before the first hunk, between hunks, and after the last hunk, with hidden counts and the following hunk header', () => {
    const rows = buildRows(hunks, newLines, newCount, new Map())

    expect(rows.filter(isGap)).toEqual([
      { type: 'gap', index: 0, hidden: 4, canExpandUp: true, canExpandDown: false, header: 'hunk1 header' },
      { type: 'gap', index: 1, hidden: 7, canExpandUp: true, canExpandDown: true, header: 'hunk2 header' },
      { type: 'gap', index: 2, hidden: 8, canExpandUp: false, canExpandDown: true, header: '' },
    ])
  })

  it('numbers old and new lines for context, add, and del rows across hunks, tracking the offset', () => {
    const rows = buildRows(hunks, newLines, newCount, new Map())

    expect(rows.filter(isLine)).toEqual([
      { type: 'line', kind: 'context', oldNo: 5, newNo: 5, text: 'line5' },
      { type: 'line', kind: 'del', oldNo: 6, newNo: null, text: 'old6' },
      { type: 'line', kind: 'add', oldNo: null, newNo: 6, text: 'new6a' },
      { type: 'line', kind: 'add', oldNo: null, newNo: 7, text: 'new6b' },
      { type: 'line', kind: 'context', oldNo: 7, newNo: 8, text: 'line8' },
      { type: 'line', kind: 'context', oldNo: 15, newNo: 16, text: 'c15' },
      { type: 'line', kind: 'del', oldNo: 16, newNo: null, text: 'd16' },
      { type: 'line', kind: 'add', oldNo: null, newNo: 17, text: 'a17' },
      { type: 'line', kind: 'del', oldNo: 17, newNo: null, text: 'd17b' },
    ])
  })
})

describe('buildRows expansions', () => {
  it('expands the first gap from the bottom, revealing lines right before the next hunk', () => {
    const expansions = new Map<number, Expansion>([[0, { fromTop: 0, fromBottom: 3 }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.slice(0, 4)).toEqual([
      { type: 'gap', index: 0, hidden: 1, canExpandUp: true, canExpandDown: false, header: 'hunk1 header' },
      { type: 'line', kind: 'context', oldNo: 2, newNo: 2, text: 'L2' },
      { type: 'line', kind: 'context', oldNo: 3, newNo: 3, text: 'L3' },
      { type: 'line', kind: 'context', oldNo: 4, newNo: 4, text: 'L4' },
    ])
  })

  it('expands the trailing gap from the top, revealing lines right after the previous hunk', () => {
    const expansions = new Map<number, Expansion>([[2, { fromTop: 5, fromBottom: 0 }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.slice(rows.length - 6)).toEqual([
      { type: 'line', kind: 'context', oldNo: 18, newNo: 18, text: 'L18' },
      { type: 'line', kind: 'context', oldNo: 19, newNo: 19, text: 'L19' },
      { type: 'line', kind: 'context', oldNo: 20, newNo: 20, text: 'L20' },
      { type: 'line', kind: 'context', oldNo: 21, newNo: 21, text: 'L21' },
      { type: 'line', kind: 'context', oldNo: 22, newNo: 22, text: 'L22' },
      { type: 'gap', index: 2, hidden: 3, canExpandUp: false, canExpandDown: true, header: '' },
    ])
  })

  it('expands a middle gap from both directions, revealing context after the previous hunk and before the next', () => {
    const expansions = new Map<number, Expansion>([[1, { fromTop: 3, fromBottom: 2 }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.filter(isGap)[1]).toEqual({
      type: 'gap',
      index: 1,
      hidden: 2,
      canExpandUp: true,
      canExpandDown: true,
      header: 'hunk2 header',
    })

    const revealed = rows.filter(isLine).filter((r) => r.newNo !== null && r.newNo >= 9 && r.newNo <= 15)
    expect(revealed).toEqual([
      { type: 'line', kind: 'context', oldNo: 8, newNo: 9, text: 'L9' },
      { type: 'line', kind: 'context', oldNo: 9, newNo: 10, text: 'L10' },
      { type: 'line', kind: 'context', oldNo: 10, newNo: 11, text: 'L11' },
      { type: 'line', kind: 'context', oldNo: 13, newNo: 14, text: 'L14' },
      { type: 'line', kind: 'context', oldNo: 14, newNo: 15, text: 'L15' },
    ])
  })

  it('caps an over-expansion at the gap size without duplicating lines', () => {
    const expansions = new Map<number, Expansion>([[1, { fromTop: 100, fromBottom: 100 }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.filter(isGap).some((g) => g.index === 1)).toBe(false)
    const revealed = rows
      .filter(isLine)
      .filter((r) => r.newNo !== null && r.newNo >= 9 && r.newNo <= 15)
      .map((r) => r.newNo)
    expect(revealed).toEqual([9, 10, 11, 12, 13, 14, 15])
  })

  it('removes the first gap entirely when expanded to infinity in both directions', () => {
    const expansions = new Map<number, Expansion>([[0, { fromTop: Infinity, fromBottom: Infinity }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.filter(isGap).map((g) => g.index)).toEqual([1, 2])
    const revealed = rows
      .filter(isLine)
      .filter((r) => r.newNo !== null && r.newNo <= 4)
      .map((r) => r.newNo)
    expect(revealed).toEqual([1, 2, 3, 4])
  })

  it('removes a middle gap entirely when expanded to infinity in both directions', () => {
    const expansions = new Map<number, Expansion>([[1, { fromTop: Infinity, fromBottom: Infinity }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.filter(isGap).map((g) => g.index)).toEqual([0, 2])
    const revealed = rows
      .filter(isLine)
      .filter((r) => r.newNo !== null && r.newNo >= 9 && r.newNo <= 15)
      .map((r) => r.newNo)
    expect(revealed).toEqual([9, 10, 11, 12, 13, 14, 15])
  })

  it('removes the trailing gap entirely when expanded to infinity in both directions', () => {
    const expansions = new Map<number, Expansion>([[2, { fromTop: Infinity, fromBottom: Infinity }]])
    const rows = buildRows(hunks, newLines, newCount, expansions)

    expect(rows.filter(isGap).map((g) => g.index)).toEqual([0, 1])
    const revealed = rows
      .filter(isLine)
      .filter((r) => r.newNo !== null && r.newNo >= 18)
      .map((r) => r.newNo)
    expect(revealed).toEqual([18, 19, 20, 21, 22, 23, 24, 25])
  })
})

describe('buildRows with whole-file hunks', () => {
  it('numbers a whole-file addition with no gaps', () => {
    const hunk: Hunk = {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
      header: '',
      lines: [
        { kind: 'add', text: 'one' },
        { kind: 'add', text: 'two' },
        { kind: 'add', text: 'three' },
      ],
    }

    expect(buildRows([hunk], ['one', 'two', 'three'], 3, new Map())).toEqual([
      { type: 'line', kind: 'add', oldNo: null, newNo: 1, text: 'one' },
      { type: 'line', kind: 'add', oldNo: null, newNo: 2, text: 'two' },
      { type: 'line', kind: 'add', oldNo: null, newNo: 3, text: 'three' },
    ])
  })

  it('numbers a whole-file deletion with no gaps', () => {
    const hunk: Hunk = {
      oldStart: 1,
      oldLines: 3,
      newStart: 0,
      newLines: 0,
      header: '',
      lines: [
        { kind: 'del', text: 'one' },
        { kind: 'del', text: 'two' },
        { kind: 'del', text: 'three' },
      ],
    }

    expect(buildRows([hunk], [], 0, new Map())).toEqual([
      { type: 'line', kind: 'del', oldNo: 1, newNo: null, text: 'one' },
      { type: 'line', kind: 'del', oldNo: 2, newNo: null, text: 'two' },
      { type: 'line', kind: 'del', oldNo: 3, newNo: null, text: 'three' },
    ])
  })
})

describe('buildRows with no hunks', () => {
  it('returns an empty array', () => {
    expect(buildRows([], [], 0, new Map())).toEqual([])
  })
})
