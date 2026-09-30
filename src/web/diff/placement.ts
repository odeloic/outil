import type { LineSide } from '../../shared/api.ts'
import type { GapRow, LineRow } from './rows.ts'
import type { SplitLineRow } from './split.ts'

export type PlacementRow = LineRow | SplitLineRow | GapRow

function rowMatch(row: PlacementRow, side: LineSide, line: number): 'line' | 'context' | null {
  if (row.type === 'gap') return null
  if (row.type === 'line') {
    const no = side === 'old' ? row.oldNo : row.newNo
    if (no !== line) return null
    return row.kind === 'context' ? 'context' : 'line'
  }
  const half = side === 'old' ? row.left : row.right
  if (!half || half.no !== line) return null
  return half.kind === 'context' ? 'context' : 'line'
}

export function findAnchorRow(rows: PlacementRow[], side: LineSide, endLine: number): number {
  let best = -1
  let bestKind: 'line' | 'context' | null = null
  for (let i = 0; i < rows.length; i++) {
    const kind = rowMatch(rows[i], side, endLine)
    if (!kind) continue
    if (bestKind === 'line' && kind === 'context') continue
    best = i
    bestKind = kind
  }
  return best
}
