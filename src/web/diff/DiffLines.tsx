import { Fragment, memo, useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { LineSide, Review, Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { Button, Icon } from '../design-system'
import { PendingThreadCard, ThreadView } from '../threads/ThreadView.tsx'
import type { HeightStore } from './heightStore.ts'
import type { Token } from './highlight.ts'
import { EXPAND_STEP, type Expansion, type GapRow, type LineRow } from './rows.ts'
import type { SplitLineRow, SplitSide } from './split.ts'

export type Tokens = { old: Token[][] | null; new: Token[][] | null }
export type DisplayRow = LineRow | SplitLineRow | GapRow
export type ExpandGap = (index: number, change: Partial<Expansion> | 'all') => void
export type GutterClick = (side: LineSide, no: number, shiftKey: boolean) => void
export type RegisterButtonRef = (key: string, el: HTMLButtonElement | null) => void

export type RowExtra =
  | { kind: 'thread'; thread: Thread }
  | { kind: 'pending'; anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'> }

export type RowExtras = ReadonlyMap<number, RowExtra[]>

export type PendingComposer = { onSave: (body: string) => Promise<Review>; onCancel: () => void }

export type ThreadHandlers = {
  reviewerInitials: string
  runs: Run[]
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: (anchor: ThreadAnchor) => void
  onSaveEdit: (id: string, body: string, anchor: ThreadAnchor) => Promise<unknown>
  onDelete: (id: string, anchor: ThreadAnchor) => Promise<unknown>
  onReply: (threadId: string, body: string) => Promise<unknown>
  onMarkRead: (id: string) => Promise<unknown>
  onResolve: (id: string, resolved: boolean) => Promise<unknown>
}

export type Comments = {
  onGutterClick: GutterClick
  registerButtonRef: RegisterButtonRef
  selected: ReadonlySet<string> | null
  rowExtras: RowExtras
  pendingComposer: PendingComposer
  threadHandlers: ThreadHandlers
  heightStore: HeightStore
}

const SIGN = { context: ' ', add: '+', del: '−' } as const
const SPOKEN = { context: null, add: 'added', del: 'removed' } as const

function isSelected(selected: ReadonlySet<string> | null, side: LineSide, no: number | null): boolean {
  return no !== null && (selected?.has(`${side}:${no}`) ?? false)
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

function CommentButton({
  side,
  no,
  pressed,
  onClick,
  registerRef,
}: {
  side: LineSide
  no: number
  pressed: boolean
  onClick: GutterClick
  registerRef: RegisterButtonRef
}) {
  return (
    <button
      ref={(el) => registerRef(`${side}:${no}`, el)}
      type="button"
      className="diff__comment-btn"
      aria-label={side === 'old' ? `Comment on old line ${no}` : `Comment on line ${no}`}
      aria-pressed={pressed}
      onClick={(event) => onClick(side, no, event.shiftKey)}
    >
      <span aria-hidden="true">+</span>
    </button>
  )
}

const UnifiedLine = memo(
  function UnifiedLine({
    row,
    tokens,
    selected,
    onGutterClick,
    registerRef,
  }: {
    row: LineRow
    tokens: Token[] | undefined
    selected: boolean
    onGutterClick: GutterClick
    registerRef: RegisterButtonRef
  }) {
    const side: LineSide = row.kind === 'del' ? 'old' : 'new'
    const no = side === 'old' ? row.oldNo : row.newNo
    return (
      <div className={`diff__row diff__line diff__line--${row.kind}${selected ? ' diff__line--selected' : ''}`}>
        {no !== null && <CommentButton side={side} no={no} pressed={selected} onClick={onGutterClick} registerRef={registerRef} />}
        <span className="diff__num">{row.oldNo}</span>
        <span className="diff__num">{row.newNo}</span>
        <Cells kind={row.kind} text={row.text} tokens={tokens} />
      </div>
    )
  },
  (a, b) =>
    a.tokens === b.tokens &&
    a.selected === b.selected &&
    a.onGutterClick === b.onGutterClick &&
    a.registerRef === b.registerRef &&
    a.row.kind === b.row.kind &&
    a.row.oldNo === b.row.oldNo &&
    a.row.newNo === b.row.newNo &&
    a.row.text === b.row.text,
)

function Half({
  side,
  data,
  tokens,
  selected,
  onGutterClick,
  registerRef,
}: {
  side: LineSide
  data: SplitSide | null
  tokens: Token[] | undefined
  selected: boolean
  onGutterClick: GutterClick
  registerRef: RegisterButtonRef
}) {
  if (!data) return <div className="diff__half diff__half--empty" />
  return (
    <div className={`diff__half diff__line diff__line--${data.kind}${selected ? ' diff__line--selected' : ''}`}>
      <CommentButton side={side} no={data.no} pressed={selected} onClick={onGutterClick} registerRef={registerRef} />
      <span className="diff__num">{data.no}</span>
      <Cells kind={data.kind} text={data.text} tokens={tokens} />
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
    leftSelected,
    rightSelected,
    onGutterClick,
    registerRef,
  }: {
    row: SplitLineRow
    leftTokens: Token[] | undefined
    rightTokens: Token[] | undefined
    leftSelected: boolean
    rightSelected: boolean
    onGutterClick: GutterClick
    registerRef: RegisterButtonRef
  }) {
    return (
      <div className="diff__row">
        <Half side="old" data={row.left} tokens={leftTokens} selected={leftSelected} onGutterClick={onGutterClick} registerRef={registerRef} />
        <Half side="new" data={row.right} tokens={rightTokens} selected={rightSelected} onGutterClick={onGutterClick} registerRef={registerRef} />
      </div>
    )
  },
  (a, b) =>
    a.leftTokens === b.leftTokens &&
    a.rightTokens === b.rightTokens &&
    a.leftSelected === b.leftSelected &&
    a.rightSelected === b.rightSelected &&
    a.onGutterClick === b.onGutterClick &&
    a.registerRef === b.registerRef &&
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
            <Icon name="arrow-down" /> Show {step} lines
          </Button>
        )}
        {row.canExpandUp && row.hidden > EXPAND_STEP && (
          <Button variant="ghost" onClick={() => onExpand(row.index, { fromBottom: step })}>
            <Icon name="arrow-up" /> Show {step} lines
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

type Pane = 'left' | 'right' | null

function extraId(extra: RowExtra): string {
  return extra.kind === 'thread' ? extra.thread.id : 'pending'
}

function extraSide(extra: RowExtra): LineSide {
  return extra.kind === 'thread' ? extra.thread.anchor.side : extra.anchor.side
}

const HeightTrackedCard = memo(function HeightTrackedCard({
  id,
  store,
  children,
}: {
  id: string
  store: HeightStore
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (height !== undefined) store.setHeight(id, Math.ceil(height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, store])

  return (
    <div ref={ref} style={{ display: 'flow-root' }}>
      {children}
    </div>
  )
})

const MirrorSpacer = memo(function MirrorSpacer({ id, store }: { id: string; store: HeightStore }) {
  const height = useSyncExternalStore(
    (listener) => store.subscribe(id, listener),
    () => store.getHeight(id),
  )
  return <div className="thread-card-spacer" style={{ height }} inert aria-hidden="true" />
})

function ExtrasAtRow({ index, comments, pane = null }: { index: number; comments: Comments; pane?: Pane }) {
  const extras = comments.rowExtras.get(index)
  if (!extras) return null
  const { threadHandlers, pendingComposer, heightStore } = comments
  return (
    <>
      {extras.map((extra) => {
        const id = extraId(extra)
        const nativePane = extraSide(extra) === 'old' ? 'left' : 'right'
        const mirror = pane !== null && nativePane !== pane
        if (mirror) {
          return <MirrorSpacer key={id} id={id} store={heightStore} />
        }
        const card =
          extra.kind === 'thread' ? (
            <ThreadView
              thread={extra.thread}
              runs={threadHandlers.runs}
              reviewerInitials={threadHandlers.reviewerInitials}
              editingId={threadHandlers.editingId}
              onStartEdit={threadHandlers.onStartEdit}
              onCancelEdit={threadHandlers.onCancelEdit}
              onSaveEdit={threadHandlers.onSaveEdit}
              onDelete={threadHandlers.onDelete}
              onReply={threadHandlers.onReply}
              onMarkRead={threadHandlers.onMarkRead}
              onResolve={threadHandlers.onResolve}
            />
          ) : (
            <PendingThreadCard anchor={extra.anchor} onSave={pendingComposer.onSave} onCancel={pendingComposer.onCancel} />
          )
        return pane === null ? (
          <Fragment key={id}>{card}</Fragment>
        ) : (
          <HeightTrackedCard key={id} id={id} store={heightStore}>
            {card}
          </HeightTrackedCard>
        )
      })}
    </>
  )
}

const MemoExtrasAtRow = memo(ExtrasAtRow)

export const Chunk = memo(function Chunk({
  rows,
  tokens,
  onExpand,
  comments,
  rowOffset,
}: {
  rows: DisplayRow[]
  tokens: Tokens | null
  onExpand: ExpandGap
  comments: Comments
  rowOffset: number
}) {
  return (
    <div className="diff__chunk" style={{ '--diff-chunk-rows': rows.length } as CSSProperties}>
      {rows.map((row, i) => {
        const globalIndex = rowOffset + i
        if (row.type === 'gap') return <Gap key={`gap-${row.index}`} row={row} onExpand={onExpand} />
        if (row.type === 'split') {
          return (
            <Fragment key={`${row.left?.no}:${row.right?.no}`}>
              <SplitLine
                row={row}
                leftTokens={lineTokens(tokens, 'old', row.left?.no)}
                rightTokens={lineTokens(tokens, 'new', row.right?.no)}
                leftSelected={isSelected(comments.selected, 'old', row.left?.no ?? null)}
                rightSelected={isSelected(comments.selected, 'new', row.right?.no ?? null)}
                onGutterClick={comments.onGutterClick}
                registerRef={comments.registerButtonRef}
              />
              <MemoExtrasAtRow index={globalIndex} comments={comments} />
            </Fragment>
          )
        }
        const side: LineSide = row.kind === 'del' ? 'old' : 'new'
        const no = side === 'old' ? row.oldNo : row.newNo
        return (
          <Fragment key={`${row.oldNo}:${row.newNo}`}>
            <UnifiedLine
              row={row}
              tokens={row.kind === 'del' ? lineTokens(tokens, 'old', row.oldNo) : lineTokens(tokens, 'new', row.newNo)}
              selected={isSelected(comments.selected, side, no)}
              onGutterClick={comments.onGutterClick}
              registerRef={comments.registerButtonRef}
            />
            <MemoExtrasAtRow index={globalIndex} comments={comments} />
          </Fragment>
        )
      })}
    </div>
  )
})

const PaneLine = memo(
  function PaneLine({
    side,
    data,
    tokens,
    selected,
    onGutterClick,
    registerRef,
  }: {
    side: LineSide
    data: SplitSide | null
    tokens: Token[] | undefined
    selected: boolean
    onGutterClick: GutterClick
    registerRef: RegisterButtonRef
  }) {
    return <Half side={side} data={data} tokens={tokens} selected={selected} onGutterClick={onGutterClick} registerRef={registerRef} />
  },
  (a, b) =>
    a.tokens === b.tokens &&
    a.selected === b.selected &&
    a.onGutterClick === b.onGutterClick &&
    a.registerRef === b.registerRef &&
    sameSide(a.data, b.data),
)

export const PaneChunk = memo(function PaneChunk({
  rows,
  pane,
  tokens,
  onExpand,
  comments,
  rowOffset,
}: {
  rows: DisplayRow[]
  pane: 'left' | 'right'
  tokens: Tokens | null
  onExpand: ExpandGap
  comments: Comments
  rowOffset: number
}) {
  const side: LineSide = pane === 'left' ? 'old' : 'new'
  return (
    <div className="diff__chunk" style={{ '--diff-chunk-rows': rows.length } as CSSProperties}>
      {rows.map((row, i) => {
        const globalIndex = rowOffset + i
        if (row.type === 'gap') {
          return <Gap key={`gap-${row.index}`} row={row} onExpand={onExpand} mirror={pane === 'right'} />
        }
        if (row.type !== 'split') return null
        const data = pane === 'left' ? row.left : row.right
        return (
          <Fragment key={data ? data.no : `empty-${i}`}>
            <PaneLine
              side={side}
              data={data}
              tokens={lineTokens(tokens, pane === 'left' ? 'old' : 'new', data?.no)}
              selected={isSelected(comments.selected, side, data?.no ?? null)}
              onGutterClick={comments.onGutterClick}
              registerRef={comments.registerButtonRef}
            />
            <MemoExtrasAtRow index={globalIndex} comments={comments} pane={pane} />
          </Fragment>
        )
      })}
    </div>
  )
})
