import type { CommitDetails } from '../../shared/api.ts'
import { Tag } from '../design-system'
import { relativeTime } from '../format.ts'
import { RangeSelector } from './RangeSelector.tsx'
import './CommitHeader.css'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function CommitHeader({ commit }: { commit: CommitDetails }) {
  const date = new Date(commit.date)
  const isMerge = commit.parents.length > 1

  return (
    <header className="commit-header">
      <div className="commit-header__title">
        {isMerge && <Tag>Merge</Tag>}
        <h1 className="commit-header__subject">
          {commit.subject || <span className="commit-header__muted">No commit message</span>}
        </h1>
      </div>
      <RangeSelector base={commit.parents[0] ?? null} head={commit.sha}>
        <span className="commit-header__meta">
          <span title={commit.author.email}>{commit.author.name}</span> ·{' '}
          <time dateTime={commit.date} title={dateFormat.format(date)}>
            {relativeTime(commit.date)}
          </time>
        </span>
      </RangeSelector>
      {commit.body && <pre className="commit-header__body">{commit.body}</pre>}
    </header>
  )
}
