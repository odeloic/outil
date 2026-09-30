import type { GapRow, LineRow, Row } from './rows.ts'

export type SplitSide = { no: number; text: string; kind: LineRow['kind'] }

export type SplitLineRow = { type: 'split'; left: SplitSide | null; right: SplitSide | null }

export type SplitRow = SplitLineRow | GapRow

function side(row: LineRow, which: 'old' | 'new'): SplitSide {
  return { no: (which === 'old' ? row.oldNo : row.newNo)!, text: row.text, kind: row.kind }
}

export function toSplitRows(rows: Row[]): SplitRow[] {
  const result: SplitRow[] = []
  let dels: LineRow[] = []
  let adds: LineRow[] = []

  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      result.push({
        type: 'split',
        left: dels[i] ? side(dels[i], 'old') : null,
        right: adds[i] ? side(adds[i], 'new') : null,
      })
    }
    dels = []
    adds = []
  }

  for (const row of rows) {
    if (row.type === 'line' && row.kind === 'del') {
      if (adds.length > 0) flush()
      dels.push(row)
    } else if (row.type === 'line' && row.kind === 'add') {
      adds.push(row)
    } else {
      flush()
      result.push(row.type === 'gap' ? row : { type: 'split', left: side(row, 'old'), right: side(row, 'new') })
    }
  }
  flush()
  return result
}
