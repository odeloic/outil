import type { Hunk } from '../../shared/api.ts'

export type LineRow = {
  type: 'line'
  kind: 'context' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
}

export type GapRow = {
  type: 'gap'
  index: number
  hidden: number
  canExpandUp: boolean
  canExpandDown: boolean
  header: string
}

export type Row = LineRow | GapRow

export type Expansion = { fromTop: number; fromBottom: number }

export type MustShow = { old: ReadonlySet<number>; new: ReadonlySet<number> }

export const EXPAND_STEP = 20

export function splitLines(text: string | null): string[] {
  if (text === null || text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function firstLine(start: number, count: number): number {
  return count === 0 ? start + 1 : start
}

function gapHasRequiredLine(mustShow: MustShow | undefined, start: number, end: number, offset: number): boolean {
  if (!mustShow) return false
  for (let newNo = start; newNo <= end; newNo++) {
    if (mustShow.new.has(newNo) || mustShow.old.has(newNo + offset)) return true
  }
  return false
}

function neededFromTop(mustShow: MustShow | undefined, start: number, end: number, offset: number): number {
  if (!mustShow) return 0
  let need = 0
  for (let newNo = start; newNo <= end; newNo++) {
    if (mustShow.new.has(newNo) || mustShow.old.has(newNo + offset)) need = newNo - start + 1
  }
  return need
}

function neededFromBottom(mustShow: MustShow | undefined, start: number, end: number, offset: number): number {
  if (!mustShow) return 0
  let need = 0
  for (let newNo = end; newNo >= start; newNo--) {
    if (mustShow.new.has(newNo) || mustShow.old.has(newNo + offset)) need = end - newNo + 1
  }
  return need
}

export function buildRows(
  hunks: Hunk[],
  newLines: string[],
  newCount: number,
  expansions: ReadonlyMap<number, Expansion>,
  mustShow?: MustShow,
): Row[] {
  const rows: Row[] = []
  let oldNext = 1
  let newNext = 1

  const pushGap = (index: number, gapNewEnd: number, offset: number, header: string) => {
    const size = gapNewEnd - newNext + 1
    if (size <= 0) return
    const isFirst = index === 0
    const isLast = index === hunks.length
    const { fromTop, fromBottom } = expansions.get(index) ?? { fromTop: 0, fromBottom: 0 }
    let top: number
    let bottom: number
    if (isFirst) {
      top = 0
      bottom = Math.min(Math.max(fromBottom, neededFromBottom(mustShow, newNext, gapNewEnd, offset)), size)
    } else if (isLast) {
      top = Math.min(Math.max(fromTop, neededFromTop(mustShow, newNext, gapNewEnd, offset)), size)
      bottom = 0
    } else if (gapHasRequiredLine(mustShow, newNext, gapNewEnd, offset)) {
      top = size
      bottom = 0
    } else {
      top = Math.min(fromTop, size)
      bottom = Math.min(fromBottom, size - top)
    }
    const context = (newNo: number): LineRow => ({
      type: 'line',
      kind: 'context',
      oldNo: newNo + offset,
      newNo,
      text: newLines[newNo - 1] ?? '',
    })
    for (let n = newNext; n < newNext + top; n++) rows.push(context(n))
    const hidden = size - top - bottom
    if (hidden > 0) {
      rows.push({ type: 'gap', index, hidden, canExpandUp: !isLast, canExpandDown: !isFirst, header })
    }
    for (let n = gapNewEnd - bottom + 1; n <= gapNewEnd; n++) rows.push(context(n))
  }

  hunks.forEach((hunk, index) => {
    const oldFirst = firstLine(hunk.oldStart, hunk.oldLines)
    const newFirst = firstLine(hunk.newStart, hunk.newLines)
    pushGap(index, newFirst - 1, oldFirst - newFirst, hunk.header)

    let oldNo = oldFirst
    let newNo = newFirst
    for (const line of hunk.lines) {
      if (line.kind === 'context') rows.push({ type: 'line', kind: 'context', oldNo: oldNo++, newNo: newNo++, text: line.text })
      else if (line.kind === 'del') rows.push({ type: 'line', kind: 'del', oldNo: oldNo++, newNo: null, text: line.text })
      else rows.push({ type: 'line', kind: 'add', oldNo: null, newNo: newNo++, text: line.text })
    }
    oldNext = oldNo
    newNext = newNo
  })

  if (hunks.length > 0) pushGap(hunks.length, newCount, oldNext - newNext, '')
  return rows
}
