import { useState } from 'react'
import type { Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { threadStatus } from '../../shared/review.ts'
import { Avatar, Button, Note, StatusChip } from '../design-system'
import { anchorLabel } from './anchorLabel.ts'
import { Composer } from './Composer.tsx'
import './Threads.css'

type Props = {
  thread: Thread
  runs: Run[]
  reviewerInitials: string
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: (anchor: ThreadAnchor) => void
  onSaveEdit: (id: string, body: string, anchor: ThreadAnchor) => Promise<unknown>
  onDelete: (id: string, anchor: ThreadAnchor) => Promise<unknown>
}

export function ThreadView({ thread, runs, reviewerInitials, editingId, onStartEdit, onCancelEdit, onSaveEdit, onDelete }: Props) {
  const status = threadStatus(thread, runs)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const label = anchorLabel(thread.anchor)

  const handleDelete = (id: string) => {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    onDelete(id, thread.anchor).catch((err: Error) => {
      setDeleting(false)
      setDeleteError(err.message)
    })
  }

  return (
    <div className={`thread-card${status === 'draft' ? ' thread-card--draft' : ''}`}>
      <div className="thread-card__header">
        <StatusChip status={status} />
        <span className="thread-card__anchor">{label}</span>
      </div>
      {thread.messages.map((message) =>
        editingId === message.id ? (
          <Composer
            key={message.id}
            initialBody={message.body}
            onSave={(body) => onSaveEdit(message.id, body, thread.anchor)}
            onCancel={() => onCancelEdit(thread.anchor)}
            ariaLabel={`Edit comment on ${label}`}
          />
        ) : (
          <div className="thread-card__message" key={message.id}>
            <Avatar kind={message.author} initials={message.author === 'reviewer' ? reviewerInitials : undefined} />
            <div className="thread-card__body-wrap">
              <p className="thread-card__body">{message.body}</p>
              {message.author === 'reviewer' && message.state === 'draft' && (
                <span className="thread-card__actions">
                  <Button variant="ghost" onClick={() => onStartEdit(message.id)} aria-label={`Edit comment on ${label}`}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => handleDelete(message.id)} disabled={deleting} aria-label={`Delete comment on ${label}`}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                </span>
              )}
            </div>
          </div>
        ),
      )}
      {deleteError && <Note variant="failure">{deleteError}</Note>}
    </div>
  )
}

type PendingProps = {
  anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'>
  onSave: (body: string) => Promise<unknown>
  onCancel: () => void
}

export function PendingThreadCard({ anchor, onSave, onCancel }: PendingProps) {
  const label = anchorLabel(anchor)
  return (
    <div className="thread-card thread-card--draft">
      <div className="thread-card__header">
        <StatusChip status="draft" />
        <span className="thread-card__anchor">{label}</span>
      </div>
      <Composer onSave={onSave} onCancel={onCancel} ariaLabel={`Comment on ${label}`} hint />
    </div>
  )
}
