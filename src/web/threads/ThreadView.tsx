import { useEffect, useRef, useState } from 'react'
import type { AgentMessage, Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { threadStatus } from '../../shared/review.ts'
import { useModelLabel } from '../agents/useAgentModels.ts'
import { Avatar, Button, Note, StatusChip } from '../design-system'
import { anchorLabel } from './anchorLabel.ts'
import { Composer } from './Composer.tsx'
import { useVisibleFor } from './useVisibleFor.ts'
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
  onMarkRead: (id: string) => Promise<unknown>
}

function AgentBubble({ message }: { message: AgentMessage }) {
  const label = useModelLabel(message.agent, message.model) ?? message.model
  return (
    <div className="thread-card__message">
      <Avatar kind="agent" />
      <div className="thread-card__agent-bubble">
        <p className="thread-card__agent-header">{`${AGENT_NAMES[message.agent]} · ${label}`}</p>
        <p className="thread-card__body">{message.body}</p>
      </div>
    </div>
  )
}

export function ThreadView({ thread, runs, reviewerInitials, editingId, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onMarkRead }: Props) {
  const status = threadStatus(thread, runs)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const label = anchorLabel(thread.anchor)
  const cardRef = useRef<HTMLDivElement>(null)
  const hasUnreadAgent = thread.messages.some((message) => message.author === 'agent' && !message.read)
  const unread = status === 'answered' && hasUnreadAgent
  const seenLongEnough = useVisibleFor(cardRef, 1000, unread)
  const markedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!seenLongEnough || !unread || markedIdRef.current === thread.id) return
    markedIdRef.current = thread.id
    onMarkRead(thread.id).catch(() => {
      if (markedIdRef.current === thread.id) markedIdRef.current = null
    })
  }, [seenLongEnough, unread, onMarkRead, thread.id])

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
    <div ref={cardRef} className={`thread-card${status === 'draft' ? ' thread-card--draft' : ''}`}>
      <div className="thread-card__header">
        <StatusChip status={status} unread={unread} />
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
        ) : message.author === 'agent' ? (
          <AgentBubble key={message.id} message={message} />
        ) : (
          <div className="thread-card__message" key={message.id}>
            <Avatar kind="reviewer" initials={reviewerInitials} />
            <div className="thread-card__body-wrap">
              <p className="thread-card__body">{message.body}</p>
              {message.state === 'draft' && (
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
