import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { FileChange, FileChangeStatus, FileDiff } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'
import { Button, DiffStat, FileStatusBadge, Note, Spinner, Tag, type FileStatus, type NoteVariant } from '../design-system'
import { highlight, type Token } from './highlight.ts'
import { buildRows, EXPAND_STEP, splitLines, type Expansion, type GapRow, type LineRow, type Row } from './rows.ts'
import { useInView } from './useInView.ts'
import { useProgressive } from './useProgressive.ts'
import './FileDiff.css'
import './syntax.css'

const BADGE: Record<FileChangeStatus, FileStatus> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }
const SIGN = { context: ' ', add: '+', del: '−' } as const
const MAX_ROWS_BEFORE_ASKING = 3000
const RENDER_STEP = 400

type Range = { base: string | null; head: string }
type Tokens = { old: Token[][] | null; new: Token[][] | null }

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function BodyNote({ variant = 'hint', action, children }: { variant?: NoteVariant; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="file-diff__note">
      <Note variant={variant} action={action}>
        {children}
      </Note>
    </div>
  )
}

function Code({ tokens, text }: { tokens: Token[] | undefined; text: string }) {
  if (!tokens) return <>{text}</>
  return (
    <>
      {tokens.map(([className, part], i) =>
        className ? (
          <span key={i} className={className}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function lineTokens(row: LineRow, tokens: Tokens | null): Token[] | undefined {
  if (!tokens) return undefined
  return row.kind === 'del' ? tokens.old?.[row.oldNo! - 1] : tokens.new?.[row.newNo! - 1]
}

const Line = memo(
  function Line({ row, tokens }: { row: LineRow; tokens: Token[] | undefined }) {
    return (
      <div className={`diff__row diff__row--${row.kind}`}>
        <span className="diff__num">{row.oldNo}</span>
        <span className="diff__num">{row.newNo}</span>
        <span className="diff__sign" aria-hidden="true">
          {SIGN[row.kind]}
        </span>
        <span className="diff__code">
          {row.kind !== 'context' && <span className="visually-hidden">{row.kind === 'add' ? 'added' : 'removed'}</span>}
          <Code tokens={tokens} text={row.text} />
        </span>
      </div>
    )
  },
  (a, b) =>
    a.tokens === b.tokens &&
    a.row.kind === b.row.kind &&
    a.row.oldNo === b.row.oldNo &&
    a.row.newNo === b.row.newNo &&
    a.row.text === b.row.text,
)

const Chunk = memo(function Chunk({
  rows,
  tokens,
  onExpand,
}: {
  rows: Row[]
  tokens: Tokens | null
  onExpand: (index: number, change: Partial<Expansion> | 'all') => void
}) {
  return (
    <div className="diff__chunk">
      {rows.map((row) =>
        row.type === 'gap' ? (
          <Gap key={`gap-${row.index}`} row={row} onExpand={onExpand} />
        ) : (
          <Line key={`${row.oldNo}:${row.newNo}`} row={row} tokens={lineTokens(row, tokens)} />
        ),
      )}
    </div>
  )
})

function Gap({ row, onExpand }: { row: GapRow; onExpand: (index: number, change: Partial<Expansion> | 'all') => void }) {
  const step = Math.min(EXPAND_STEP, row.hidden)
  return (
    <div className="diff__gap">
      <span className="diff__gap-actions">
          {row.canExpandDown && row.hidden > EXPAND_STEP && (
            <Button variant="ghost" onClick={() => onExpand(row.index, { fromTop: step })}>
              ↓ Show {step} lines
            </Button>
          )}
          {row.canExpandUp && row.hidden > EXPAND_STEP && (
            <Button variant="ghost" onClick={() => onExpand(row.index, { fromBottom: step })}>
              ↑ Show {step} lines
            </Button>
          )}
          <Button variant="ghost" onClick={() => onExpand(row.index, 'all')}>
            Show {row.hidden === 1 ? '1 hidden line' : `all ${row.hidden} hidden lines`}
          </Button>
          {row.header && <code className="diff__gap-header">{row.header}</code>}
      </span>
    </div>
  )
}

function TextDiff({ path, diff }: { path: string; diff: Extract<FileDiff, { kind: 'text' }> }) {
  const [expansions, setExpansions] = useState<ReadonlyMap<number, Expansion>>(new Map())
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const newLines = useMemo(() => splitLines(diff.newText), [diff.newText])
  const numberWidth = useMemo(
    () => String(Math.max(newLines.length, splitLines(diff.oldText).length)).length,
    [newLines, diff.oldText],
  )
  const rows = useMemo(
    () => buildRows(diff.hunks, newLines, newLines.length, expansions),
    [diff.hunks, newLines, expansions],
  )
  const chunks = useMemo(() => {
    const result: Row[][] = []
    for (let i = 0; i < rows.length; i += RENDER_STEP) result.push(rows.slice(i, i + RENDER_STEP))
    return result
  }, [rows])
  const changedLines = useMemo(() => diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), [diff.hunks])
  const tooMany = changedLines > MAX_ROWS_BEFORE_ASKING && !confirmed
  const rendered = useProgressive(tooMany ? 0 : chunks.length, 1, diff)
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

  const expand = useCallback((index: number, change: Partial<Expansion> | 'all') => {
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

  return (
    <div className="file-diff__scroll">
      <div className="diff" style={{ '--diff-num-digits': numberWidth, '--diff-chunk-rows': RENDER_STEP } as CSSProperties}>
        {chunks.slice(0, rendered).map((chunk, i) => (
          <Chunk key={i} rows={chunk} tokens={i < highlighted ? tokens : null} onExpand={expand} />
        ))}
      </div>
    </div>
  )
}

function FileBody({ range, file }: { range: Range; file: FileChange }) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (file.binary) return
    let cancelled = false
    const query = {
      head: range.head,
      path: file.path,
      ...(range.base ? { base: range.base } : {}),
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      ...(full ? { full: '1' } : {}),
    }
    unwrap(client.api['file-diff'].$get({ query }))
      .then((body) => !cancelled && setDiff(body))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [range.base, range.head, file.path, file.oldPath, file.binary, full])

  if (file.binary || diff?.kind === 'binary') return <BodyNote>Binary file, not shown.</BodyNote>
  if (error) return <BodyNote variant="failure">{error}</BodyNote>
  if (!diff) {
    return (
      <p className="file-diff__loading">
        <Spinner /> Loading diff…
      </p>
    )
  }
  if (diff.kind === 'too-large') {
    return (
      <BodyNote
        action={
          <Button
            onClick={() => {
              setDiff(null)
              setFull(true)
            }}
          >
            Load diff
          </Button>
        }
      >
        This file is {formatBytes(diff.bytes)} and is not loaded automatically.
      </BodyNote>
    )
  }
  return <TextDiff path={file.path} diff={diff} />
}

export const FileDiffView = memo(function FileDiffView({ range, file }: { range: Range; file: FileChange }) {
  const ref = useRef<HTMLElement>(null)
  const visible = useInView(ref, '1200px 0px')
  const estimatedLines = Math.min(file.additions + file.deletions + 6, 60)

  return (
    <section ref={ref} className="file-diff" aria-label={file.path}>
      <header className="file-diff__header">
        <FileStatusBadge status={BADGE[file.status]} />
        <span className="file-diff__path">
          {file.oldPath && (
            <>
              {file.oldPath} <span aria-hidden="true">→</span>
              <span className="visually-hidden">renamed to</span>{' '}
            </>
          )}
          {file.path}
        </span>
        {file.binary ? <Tag>Binary</Tag> : <DiffStat added={file.additions} removed={file.deletions} />}
      </header>
      <div className="file-diff__body" style={visible ? undefined : { minHeight: `calc(${estimatedLines} * var(--diff-line-height))` }}>
        {visible && <FileBody range={range} file={file} />}
      </div>
    </section>
  )
})
