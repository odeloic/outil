import { memo, useEffect, useRef, useState } from 'react'
import type { FileChange, Review, FileDiff, Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'
import { Button, Checkbox, CountBadge, DiffStat, FileStatusBadge, Icon, Spinner, Tag } from '../design-system'
import { FILE_STATUS_BADGE } from '../fileStatus.ts'
import { fileAnchor } from '../review/navigation.ts'
import { BodyNote } from './BodyNote.tsx'
import { TextDiff } from './TextDiff.tsx'
import { useInView } from './useInView.ts'
import './FileDiff.css'
import './syntax.css'

type Range = { base: string | null; head: string }

type CommentProps = {
  threads: Thread[]
  runs: Run[]
  reviewerInitials: string
  onCreateThread: (anchor: ThreadAnchor, body: string) => Promise<Review>
  onEditDraft: (id: string, body: string) => Promise<unknown>
  onDeleteDraft: (id: string) => Promise<unknown>
  onReply: (threadId: string, body: string) => Promise<unknown>
  onMarkRead: (id: string) => Promise<unknown>
  onResolve: (id: string, resolved: boolean) => Promise<unknown>
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function FileBody({
  range,
  file,
  placeholderLines,
  threads,
  runs,
  reviewerInitials,
  onCreateThread,
  onEditDraft,
  onDeleteDraft,
  onReply,
  onMarkRead,
  onResolve,
}: { range: Range; file: FileChange; placeholderLines: number } & CommentProps) {
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
      <p className="file-diff__loading" style={{ minHeight: `calc(${placeholderLines} * var(--diff-line-height))` }}>
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
  return (
    <TextDiff
      path={file.path}
      diff={diff}
      threads={threads}
      runs={runs}
      reviewerInitials={reviewerInitials}
      onCreateThread={onCreateThread}
      onEditDraft={onEditDraft}
      onDeleteDraft={onDeleteDraft}
      onReply={onReply}
      onMarkRead={onMarkRead}
      onResolve={onResolve}
    />
  )
}

type FileDiffViewProps = {
  index: number
  range: Range
  file: FileChange
  collapsed: boolean
  viewed: boolean
  onCollapse: (path: string, collapsed: boolean) => void
  onViewed: (path: string, viewed: boolean) => void
} & CommentProps

export const FileDiffView = memo(function FileDiffView({
  index,
  range,
  file,
  collapsed,
  viewed,
  onCollapse,
  onViewed,
  threads,
  runs,
  reviewerInitials,
  onCreateThread,
  onEditDraft,
  onDeleteDraft,
  onReply,
  onMarkRead,
  onResolve,
}: FileDiffViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const nearby = useInView(bodyRef, '1200px 0px')
  const estimatedLines = Math.min(file.additions + file.deletions + 6, 60)
  const bodyId = `${fileAnchor(index)}-body`

  return (
    <section
      id={fileAnchor(index)}
      data-file-index={index}
      tabIndex={-1}
      className="file-diff"
      aria-label={file.path}
    >
      <header className="file-diff__header">
        <Button
          variant="ghost"
          className="file-diff__toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
          onClick={() => onCollapse(file.path, !collapsed)}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} />
        </Button>
        <FileStatusBadge status={FILE_STATUS_BADGE[file.status]} />
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
        {threads.length > 0 && <CountBadge count={threads.length} title={`${threads.length} ${threads.length === 1 ? 'comment' : 'comments'}`} />}
        <Checkbox label="Viewed" checked={viewed} onChange={(event) => onViewed(file.path, event.target.checked)} />
      </header>
      <div
        ref={bodyRef}
        id={bodyId}
        className="file-diff__body"
        hidden={collapsed}
        style={nearby || collapsed ? undefined : { minHeight: `calc(${estimatedLines} * var(--diff-line-height))` }}
      >
        {nearby && (
          <FileBody
            range={range}
            file={file}
            placeholderLines={estimatedLines}
            threads={threads}
            runs={runs}
            reviewerInitials={reviewerInitials}
            onCreateThread={onCreateThread}
            onEditDraft={onEditDraft}
            onDeleteDraft={onDeleteDraft}
            onReply={onReply}
            onMarkRead={onMarkRead}
            onResolve={onResolve}
          />
        )}
      </div>
    </section>
  )
})
