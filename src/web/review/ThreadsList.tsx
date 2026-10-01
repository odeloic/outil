import { memo, useMemo, useState } from 'react'
import type { Run, Thread } from '../../shared/api.ts'
import { threadStatus } from '../../shared/review.ts'
import { Icon, SegmentedControl, StatusChip } from '../design-system'
import { anchorRange } from '../threads/anchorLabel.ts'
import { excerpt } from '../threads/excerpt.ts'
import { groupThreads, type ThreadFilter } from './threadGroups.ts'
import './ThreadsList.css'
import './RailRow.css'

const FILTER_OPTIONS: { value: ThreadFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
]

function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/')
  return (
    <span className="threads-list__file-path" title={path}>
      {slash >= 0 && <span className="threads-list__file-dir">{path.slice(0, slash + 1)}</span>}
      {path.slice(slash + 1)}
    </span>
  )
}

const ThreadRow = memo(function ThreadRow({
  thread,
  runs,
  active,
  onJump,
}: {
  thread: Thread
  runs: Run[]
  active: boolean
  onJump: (thread: Thread) => void
}) {
  const status = threadStatus(thread, runs)
  const unread = status === 'answered' && thread.messages.some((message) => message.author === 'agent' && !message.read)
  const last = thread.messages.at(-1)
  return (
    <li>
      <button type="button" className="rail-row threads-list__row" aria-current={active ? 'true' : undefined} onClick={() => onJump(thread)}>
        <span className="threads-list__head">
          <StatusChip status={status} unread={unread} />
          <span className="threads-list__range">{anchorRange(thread.anchor)}</span>
        </span>
        <span className="threads-list__excerpt">{last ? excerpt(last.body) : ''}</span>
      </button>
    </li>
  )
})

type Props = {
  filePaths: readonly string[]
  threads: readonly Thread[]
  runs: Run[]
  activeThreadId: string | null
  onJump: (thread: Thread) => void
}

export function ThreadsList({ filePaths, threads, runs, activeThreadId, onJump }: Props) {
  const [filter, setFilter] = useState<ThreadFilter>('open')
  const [showResolved, setShowResolved] = useState(false)

  const { groups, resolved } = useMemo(() => groupThreads(filePaths, threads, filter), [filePaths, threads, filter])

  const renderRows = (list: Thread[]) =>
    list.map((thread) => <ThreadRow key={thread.id} thread={thread} runs={runs} active={thread.id === activeThreadId} onJump={onJump} />)

  return (
    <div className="threads-list">
      <SegmentedControl<ThreadFilter> options={FILTER_OPTIONS} value={filter} onChange={setFilter} ariaLabel="Thread filter" compact />
      {groups.length === 0 && resolved.length === 0 && (
        <p className="threads-list__empty">{filter === 'open' ? 'No open threads.' : 'No threads yet.'}</p>
      )}
      {groups.map(([path, list]) => (
        <section key={path} className="threads-list__group" aria-label={path}>
          <h3 className="threads-list__file">
            <FilePath path={path} />
          </h3>
          <ul className="threads-list__rows">{renderRows(list)}</ul>
        </section>
      ))}
      {resolved.length > 0 && (
        <section className="threads-list__group">
          <button type="button" className="threads-list__fold" aria-expanded={showResolved} onClick={() => setShowResolved((value) => !value)}>
            <Icon name={showResolved ? 'chevron-down' : 'chevron-right'} />
            Resolved {resolved.length}
          </button>
          {showResolved && <ul className="threads-list__rows">{renderRows(resolved)}</ul>}
        </section>
      )}
    </div>
  )
}
