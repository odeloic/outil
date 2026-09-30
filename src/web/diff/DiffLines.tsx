import { memo } from 'react'
import { Button } from '../design-system'
import type { Token } from './highlight.ts'
import { EXPAND_STEP, type Expansion, type GapRow, type LineRow } from './rows.ts'
import type { SplitLineRow, SplitSide } from './split.ts'

export type Tokens = { old: Token[][] | null; new: Token[][] | null }
export type DisplayRow = LineRow | SplitLineRow | GapRow
export type ExpandGap = (index: number, change: Partial<Expansion> | 'all') => void

const SIGN = { context: ' ', add: '+', del: '−' } as const
const SPOKEN = { context: null, add: 'added', del: 'removed' } as const

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

function Cells({ kind, text, tokens }: { kind: LineRow['kind']; text: string; tokens: Token[] | undefined }) {
  const spoken = SPOKEN[kind]
  return (
    <>
      <span className="diff__sign" aria-hidden="true">
        {SIGN[kind]}
      </span>
      <span className="diff__code">
        {spoken && <span className="visually-hidden">{spoken}</span>}
        <Code tokens={tokens} text={text} />
      </span>
    </>
  )
}

const UnifiedLine = memo(
  function UnifiedLine({ row, tokens }: { row: LineRow; tokens: Token[] | undefined }) {
    return (
      <div className={`diff__row diff__line diff__line--${row.kind}`}>
        <span className="diff__num">{row.oldNo}</span>
        <span className="diff__num">{row.newNo}</span>
        <Cells kind={row.kind} text={row.text} tokens={tokens} />
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

function Half({ side, tokens }: { side: SplitSide | null; tokens: Token[] | undefined }) {
  if (!side) return <div className="diff__half diff__half--empty" />
  return (
    <div className={`diff__half diff__line diff__line--${side.kind}`}>
      <span className="diff__num">{side.no}</span>
      <Cells kind={side.kind} text={side.text} tokens={tokens} />
    </div>
  )
}

function sameSide(a: SplitSide | null, b: SplitSide | null): boolean {
  return a === b || (a !== null && b !== null && a.no === b.no && a.kind === b.kind && a.text === b.text)
}

const SplitLine = memo(
  function SplitLine({
    row,
    leftTokens,
    rightTokens,
  }: {
    row: SplitLineRow
    leftTokens: Token[] | undefined
    rightTokens: Token[] | undefined
  }) {
    return (
      <div className="diff__row">
        <Half side={row.left} tokens={leftTokens} />
        <Half side={row.right} tokens={rightTokens} />
      </div>
    )
  },
  (a, b) =>
    a.leftTokens === b.leftTokens &&
    a.rightTokens === b.rightTokens &&
    sameSide(a.row.left, b.row.left) &&
    sameSide(a.row.right, b.row.right),
)

function Gap({ row, onExpand, mirror = false }: { row: GapRow; onExpand: ExpandGap; mirror?: boolean }) {
  const step = Math.min(EXPAND_STEP, row.hidden)
  return (
    <div className={`diff__gap${mirror ? ' diff__gap--mirror' : ''}`} aria-hidden={mirror || undefined}>
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

function lineTokens(tokens: Tokens | null, side: 'old' | 'new', no: number | null | undefined): Token[] | undefined {
  return no ? tokens?.[side]?.[no - 1] : undefined
}

export const Chunk = memo(function Chunk({
  rows,
  tokens,
  onExpand,
}: {
  rows: DisplayRow[]
  tokens: Tokens | null
  onExpand: ExpandGap
}) {
  return (
    <div className="diff__chunk">
      {rows.map((row) => {
        if (row.type === 'gap') return <Gap key={`gap-${row.index}`} row={row} onExpand={onExpand} />
        if (row.type === 'split') {
          return (
            <SplitLine
              key={`${row.left?.no}:${row.right?.no}`}
              row={row}
              leftTokens={lineTokens(tokens, 'old', row.left?.no)}
              rightTokens={lineTokens(tokens, 'new', row.right?.no)}
            />
          )
        }
        return (
          <UnifiedLine
            key={`${row.oldNo}:${row.newNo}`}
            row={row}
            tokens={row.kind === 'del' ? lineTokens(tokens, 'old', row.oldNo) : lineTokens(tokens, 'new', row.newNo)}
          />
        )
      })}
    </div>
  )
})

const PaneLine = memo(
  function PaneLine({ side, tokens }: { side: SplitSide | null; tokens: Token[] | undefined }) {
    return <Half side={side} tokens={tokens} />
  },
  (a, b) => a.tokens === b.tokens && sameSide(a.side, b.side),
)

export const PaneChunk = memo(function PaneChunk({
  rows,
  pane,
  tokens,
  onExpand,
}: {
  rows: DisplayRow[]
  pane: 'left' | 'right'
  tokens: Tokens | null
  onExpand: ExpandGap
}) {
  return (
    <div className="diff__chunk">
      {rows.map((row, i) => {
        if (row.type === 'gap') {
          return <Gap key={`gap-${row.index}`} row={row} onExpand={onExpand} mirror={pane === 'right'} />
        }
        if (row.type !== 'split') return null
        const side = pane === 'left' ? row.left : row.right
        return (
          <PaneLine
            key={side ? side.no : `empty-${i}`}
            side={side}
            tokens={lineTokens(tokens, pane === 'left' ? 'old' : 'new', side?.no)}
          />
        )
      })}
    </div>
  )
})
