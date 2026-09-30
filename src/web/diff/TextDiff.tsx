import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { FileDiff } from '../../shared/api.ts'
import { Button } from '../design-system'
import { BodyNote } from './BodyNote.tsx'
import { useDisplaySettings } from '../settings.ts'
import { Chunk, PaneChunk, type DisplayRow, type ExpandGap, type Tokens } from './DiffLines.tsx'
import { highlight } from './highlight.ts'
import { buildRows, splitLines, type Expansion } from './rows.ts'
import { toSplitRows } from './split.ts'
import { useProgressive } from './useProgressive.ts'

const MAX_ROWS_BEFORE_ASKING = 3000
const RENDER_STEP = 400
const TAB_WIDTH = 4

export function TextDiff({ path, diff }: { path: string; diff: Extract<FileDiff, { kind: 'text' }> }) {
  const { layout, wrap } = useDisplaySettings()
  const [expansions, setExpansions] = useState<ReadonlyMap<number, Expansion>>(new Map())
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const newLines = useMemo(() => splitLines(diff.newText), [diff.newText])
  const numberDigits = useMemo(
    () => String(Math.max(newLines.length, splitLines(diff.oldText).length)).length,
    [newLines, diff.oldText],
  )
  const rows = useMemo(
    () => buildRows(diff.hunks, newLines, newLines.length, expansions),
    [diff.hunks, newLines, expansions],
  )
  const displayRows: DisplayRow[] = useMemo(() => (layout === 'split' ? toSplitRows(rows) : rows), [layout, rows])
  const chunks = useMemo(() => {
    const result: DisplayRow[][] = []
    for (let i = 0; i < displayRows.length; i += RENDER_STEP) result.push(displayRows.slice(i, i + RENDER_STEP))
    return result
  }, [displayRows])
  const changedLines = useMemo(() => diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), [diff.hunks])
  const tooMany = changedLines > MAX_ROWS_BEFORE_ASKING && !confirmed
  const renderKey = useMemo(() => ({ diff, layout, wrap }), [diff, layout, wrap])
  const rendered = useProgressive(tooMany ? 0 : chunks.length, 1, renderKey)
  const highlighted = useProgressive(tokens ? rendered : 0, 1, tokens)

  useEffect(() => {
    let cancelled = false
    highlight(path, [diff.oldText, diff.newText]).then(([oldTokens, newTokens]) => {
      if (!cancelled) setTokens({ old: oldTokens, new: newTokens })
    })
    return () => {
      cancelled = true
    }
  }, [path, diff.oldText, diff.newText])

  const expand: ExpandGap = useCallback((index, change) => {
    setExpansions((current) => {
      const next = new Map(current)
      const previous = current.get(index) ?? { fromTop: 0, fromBottom: 0 }
      next.set(
        index,
        change === 'all'
          ? { fromTop: Infinity, fromBottom: Infinity }
          : {
              fromTop: previous.fromTop + (change.fromTop ?? 0),
              fromBottom: previous.fromBottom + (change.fromBottom ?? 0),
            },
      )
      return next
    })
  }, [])

  if (diff.hunks.length === 0) {
    const empty = (diff.oldText ?? '') === '' && (diff.newText ?? '') === ''
    return <BodyNote>{empty ? 'The file is empty.' : "No changes to the file's content."}</BodyNote>
  }
  if (tooMany) {
    return (
      <BodyNote action={<Button onClick={() => setConfirmed(true)}>Show diff</Button>}>
        This diff has {changedLines.toLocaleString()} lines and is hidden to keep the page fast.
      </BodyNote>
    )
  }

  const style = {
    '--diff-num-digits': numberDigits,
    '--diff-tab-width': TAB_WIDTH,
  } as CSSProperties
  const visibleChunks = chunks.slice(0, rendered)
  if (layout === 'split' && !wrap) {
    return (
      <div className="diff diff--panes" style={style}>
        {(['left', 'right'] as const).map((pane) => (
          <div key={pane} className="diff__pane">
            <div className="diff__pane-content">
              {visibleChunks.map((chunk, i) => (
                <PaneChunk key={i} rows={chunk} pane={pane} tokens={i < highlighted ? tokens : null} onExpand={expand} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="file-diff__scroll">
      <div className={`diff diff--${layout}${wrap ? ' diff--wrap' : ''}`} style={style}>
        {visibleChunks.map((chunk, i) => (
          <Chunk key={i} rows={chunk} tokens={i < highlighted ? tokens : null} onExpand={expand} />
        ))}
      </div>
    </div>
  )
}
