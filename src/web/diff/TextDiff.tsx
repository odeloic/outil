import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { FileDiff, LineSide, Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { Button } from '../design-system'
import { BodyNote } from './BodyNote.tsx'
import { useDisplaySettings } from '../settings.ts'
import { Chunk, PaneChunk, type Comments, type DisplayRow, type ExpandGap, type RowExtra, type Tokens } from './DiffLines.tsx'
import { createHeightStore } from './heightStore.ts'
import { highlight } from './highlight.ts'
import { findAnchorRow, type PlacementRow } from './placement.ts'
import { buildRows, splitLines, type Expansion } from './rows.ts'
import { toSplitRows } from './split.ts'
import { useProgressive } from './useProgressive.ts'

const MAX_ROWS_BEFORE_ASKING = 3000
const RENDER_STEP = 400
const TAB_WIDTH = 4

type Selection = { side: LineSide; origin: number; current: number }

function normalize(selection: Selection): { side: LineSide; startLine: number; endLine: number } {
  return { side: selection.side, startLine: Math.min(selection.origin, selection.current), endLine: Math.max(selection.origin, selection.current) }
}

type Props = {
  path: string
  diff: Extract<FileDiff, { kind: 'text' }>
  threads: Thread[]
  runs: Run[]
  reviewerInitials: string
  onCreateThread: (anchor: ThreadAnchor, body: string) => Promise<unknown>
  onEditDraft: (id: string, body: string) => Promise<unknown>
  onDeleteDraft: (id: string) => Promise<unknown>
  onMarkRead: (id: string) => Promise<unknown>
}

export function TextDiff({ path, diff, threads, runs, reviewerInitials, onCreateThread, onEditDraft, onDeleteDraft, onMarkRead }: Props) {
  const { layout, wrap } = useDisplaySettings()
  const [expansions, setExpansions] = useState<ReadonlyMap<number, Expansion>>(new Map())
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [heightStore] = useState(createHeightStore)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())

  const newLines = useMemo(() => splitLines(diff.newText), [diff.newText])
  const numberDigits = useMemo(
    () => String(Math.max(newLines.length, splitLines(diff.oldText).length)).length,
    [newLines, diff.oldText],
  )
  const mustShow = useMemo(() => {
    const old = new Set<number>()
    const fresh = new Set<number>()
    for (const thread of threads) {
      const set = thread.anchor.side === 'old' ? old : fresh
      for (let n = thread.anchor.startLine; n <= thread.anchor.endLine; n++) set.add(n)
    }
    if (selection) {
      const { side, startLine, endLine } = normalize(selection)
      const set = side === 'old' ? old : fresh
      for (let n = startLine; n <= endLine; n++) set.add(n)
    }
    return { old, new: fresh }
  }, [threads, selection])
  const rows = useMemo(
    () => buildRows(diff.hunks, newLines, newLines.length, expansions, mustShow),
    [diff.hunks, newLines, expansions, mustShow],
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

  const registerButtonRef = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(key, el)
    else buttonRefs.current.delete(key)
  }, [])

  const focusAnchor = useCallback((side: LineSide, no: number) => {
    buttonRefs.current.get(`${side}:${no}`)?.focus()
  }, [])

  const onGutterClick = useCallback((side: LineSide, no: number, shiftKey: boolean) => {
    setSelection((current) => {
      if (shiftKey && current && current.side === side) return { side, origin: current.origin, current: no }
      return { side, origin: no, current: no }
    })
  }, [])

  const cancelPending = useCallback(() => {
    setSelection((current) => {
      if (current) {
        const { side, endLine } = normalize(current)
        focusAnchor(side, endLine)
      }
      return null
    })
  }, [focusAnchor])

  const savePending = useCallback(
    (body: string) => {
      if (!selection) return Promise.reject(new Error('Nothing is selected.'))
      const { side, startLine, endLine } = normalize(selection)
      return onCreateThread({ path, side, startLine, endLine }, body).then((result) => {
        setSelection(null)
        focusAnchor(side, endLine)
        return result
      })
    },
    [selection, path, onCreateThread, focusAnchor],
  )

  const onStartEdit = useCallback((id: string) => setEditingId(id), [])

  const onCancelEdit = useCallback(
    (anchor: ThreadAnchor) => {
      setEditingId(null)
      focusAnchor(anchor.side, anchor.endLine)
    },
    [focusAnchor],
  )

  const onSaveEdit = useCallback(
    (id: string, body: string, anchor: ThreadAnchor) =>
      onEditDraft(id, body).then((result) => {
        setEditingId(null)
        focusAnchor(anchor.side, anchor.endLine)
        return result
      }),
    [onEditDraft, focusAnchor],
  )

  const onDelete = useCallback(
    (id: string, anchor: ThreadAnchor) =>
      onDeleteDraft(id).then((result) => {
        focusAnchor(anchor.side, anchor.endLine)
        return result
      }),
    [onDeleteDraft, focusAnchor],
  )

  const selectedSet = useMemo(() => {
    if (!selection) return null
    const { side, startLine, endLine } = normalize(selection)
    const set = new Set<string>()
    for (let n = startLine; n <= endLine; n++) set.add(`${side}:${n}`)
    return set
  }, [selection])

  const rowExtras = useMemo(() => {
    const map = new Map<number, RowExtra[]>()
    const add = (index: number, extra: RowExtra) => {
      if (index < 0) return
      const list = map.get(index)
      if (list) list.push(extra)
      else map.set(index, [extra])
    }
    for (const thread of threads) {
      add(findAnchorRow(displayRows as PlacementRow[], thread.anchor.side, thread.anchor.endLine), { kind: 'thread', thread })
    }
    if (selection) {
      const anchor = normalize(selection)
      add(findAnchorRow(displayRows as PlacementRow[], anchor.side, anchor.endLine), { kind: 'pending', anchor })
    }
    return map
  }, [displayRows, threads, selection])

  const comments: Comments = useMemo(
    () => ({
      onGutterClick,
      registerButtonRef,
      selected: selectedSet,
      rowExtras,
      pendingComposer: { onSave: savePending, onCancel: cancelPending },
      threadHandlers: {
        reviewerInitials,
        runs,
        editingId,
        onStartEdit,
        onCancelEdit,
        onSaveEdit,
        onDelete,
        onMarkRead,
      },
      heightStore,
    }),
    [
      onGutterClick,
      registerButtonRef,
      selectedSet,
      rowExtras,
      savePending,
      cancelPending,
      reviewerInitials,
      runs,
      editingId,
      onStartEdit,
      onCancelEdit,
      onSaveEdit,
      onDelete,
      onMarkRead,
      heightStore,
    ],
  )

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
                <PaneChunk
                  key={i}
                  rows={chunk}
                  pane={pane}
                  tokens={i < highlighted ? tokens : null}
                  onExpand={expand}
                  comments={comments}
                  rowOffset={i * RENDER_STEP}
                />
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
          <Chunk key={i} rows={chunk} tokens={i < highlighted ? tokens : null} onExpand={expand} comments={comments} rowOffset={i * RENDER_STEP} />
        ))}
      </div>
    </div>
  )
}
