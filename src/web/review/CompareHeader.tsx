import type { CommitDetails, Comparison } from '../../shared/api.ts'
import { Button, Tag } from '../design-system'
import { relativeTime, shortSha } from '../format.ts'
import { navigate } from '../router.ts'
import './CompareHeader.css'

function End({ label, commit }: { label: string; commit: CommitDetails }) {
  return (
    <div className="compare-header__end">
      <span className="compare-header__label">{label}</span>
      <code className="compare-header__sha" title={commit.sha}>
        {shortSha(commit.sha)}
      </code>
      <span className="compare-header__subject">{commit.subject || 'No commit message'}</span>
      <span className="compare-header__meta">
        {commit.author.name} ·{' '}
        <time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>
          {relativeTime(commit.date)}
        </time>
      </span>
    </div>
  )
}

export function CompareHeader({ comparison }: { comparison: Comparison }) {
  const { base, head, mergeBase, commitCount } = comparison
  const contained = mergeBase === head.sha && base.sha !== head.sha
  const diverged = mergeBase !== null && mergeBase !== base.sha && !contained

  return (
    <header className="compare-header">
      <div className="compare-header__title">
        <Tag>Comparison</Tag>
        <h1 className="compare-header__heading">
          {commitCount} {commitCount === 1 ? 'commit' : 'commits'} from <code>{shortSha(base.sha)}</code> to{' '}
          <code>{shortSha(head.sha)}</code>
        </h1>
        <Button variant="ghost" onClick={() => navigate({ base: head.sha, head: base.sha })}>
          Swap
        </Button>
      </div>
      <div className="compare-header__ends">
        <End label="Base" commit={base} />
        <span className="compare-header__arrow" aria-hidden="true">
          →
        </span>
        <End label="Head" commit={head} />
      </div>
      {diverged && (
        <p className="compare-header__note">
          These histories have diverged. Changes are shown from their common ancestor,{' '}
          <code>{shortSha(mergeBase)}</code>, to the head.
        </p>
      )}
      {contained && (
        <p className="compare-header__note">
          The head is already part of the base&apos;s history, so it adds nothing. Swap them to see what the base adds.
        </p>
      )}
      {mergeBase === null && (
        <p className="compare-header__note">These commits share no history. Changes are shown between them directly.</p>
      )}
    </header>
  )
}
