import { useState } from 'react'
import type { CommitDetails } from '../../shared/api.ts'
import { Button, Tag } from '../design-system'
import { shortSha } from '../format.ts'
import './CommitHeader.css'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type CopyState = 'idle' | 'copied' | 'failed'

const COPY_LABEL: Record<CopyState, string> = { idle: 'Copy ID', copied: 'Copied', failed: 'Copy failed' }

function CopyId({ sha }: { sha: string }) {
  const [state, setState] = useState<CopyState>('idle')

  async function copy() {
    const next = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(sha))
      .then(
      () => 'copied' as const,
      () => 'failed' as const,
    )
    setState(next)
    setTimeout(() => setState('idle'), 1500)
  }

  return (
    <Button variant="ghost" onClick={copy} title={sha} aria-live="polite">
      {COPY_LABEL[state]}
    </Button>
  )
}

function Parents({ parents }: { parents: string[] }) {
  if (parents.length === 0) return <span className="commit-header__muted">Root commit, no parent</span>
  return (
    <span className="commit-header__parents">
      {parents.length > 1 ? 'Merge of' : 'Parent'}
      {parents.map((parent, i) => (
        <span key={parent}>
          <a className="commit-header__sha" href={`?ref=${parent}`} title={parent}>
            {shortSha(parent)}
          </a>
          {i < parents.length - 2 && ','}
          {i === parents.length - 2 && ' and'}
        </span>
      ))}
    </span>
  )
}

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
      {commit.body && <pre className="commit-header__body">{commit.body}</pre>}
      <div className="commit-header__meta">
        <span>
          <strong className="commit-header__author" title={commit.author.email}>
            {commit.author.name}
          </strong>{' '}
          authored <time dateTime={commit.date} title={commit.date}>{dateFormat.format(date)}</time>
        </span>
        <span className="commit-header__id">
          <code className="commit-header__sha" title={commit.sha}>
            {shortSha(commit.sha)}
          </code>
          <CopyId sha={commit.sha} />
        </span>
        <Parents parents={commit.parents} />
      </div>
    </header>
  )
}
