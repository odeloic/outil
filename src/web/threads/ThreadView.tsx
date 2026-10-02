import { useEffect, useRef, useState } from 'react'
import type { AgentMessage, Review, Run, Thread, ThreadAnchor } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { threadStatus } from '../../shared/review.ts'
import { AgentLabel } from '../agents/AgentLabel.tsx'
import { useModelLabel } from '../agents/useAgentModels.ts'
import { Avatar, Button, Note, StatusChip } from '../design-system'
import { threadCardId } from '../review/navigation.ts'
import { anchorLabel } from './anchorLabel.ts'
import { Composer } from './Composer.tsx'
import { newThreadId, useSendNow } from './useSendNow.ts'
import { MessageBody } from './MessageBody.tsx'
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
  onReply: (threadId: string, body: string) => Promise<unknown>
  onMarkRead: (id: string) => Promise<unknown>
  onResolve: (id: string, resolved: boolean) => Promise<unknown>
}

function AgentBubble({ message }: { message: AgentMessage }) {
  const label = useModelLabel(message.agent, message.model) ?? message.model
  return (
    <div className="thread-card__agent-bubble" title={`${AGENT_NAMES[message.agent]} · ${label}`}>
      <AgentLabel agent={message.agent} note="replied" size="xs" />
      <MessageBody body={message.body} />
    </div>
  )
}

export function ThreadView({
  thread,
  runs,
  reviewerInitials,
  editingId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  onMarkRead,
  onResolve,
}: Props) {
  const status = threadStatus(thread, runs)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const label = anchorLabel(thread.anchor)
  const cardRef = useRef<HTMLDivElement>(null)
  const hasUnreadAgent = thread.messages.some((message) => message.author === 'agent' && !message.read)
  const unread = status === 'answered' && hasUnreadAgent
  const seenLongEnough = useVisibleFor(cardRef, 1000, unread)
  const markedIdRef = useRef<string | null>(null)
  const isNewDraftThread = status === 'draft' && thread.messages.length === 1
  const canReply = status !== 'draft' && status !== 'resolved'
  const inActiveRun = runs.some((run) => (run.state === 'queued' || run.state === 'running') && run.threadIds.includes(thread.id))
  const { reason: sendNowReason, errors: sendNowErrors, sendNow } = useSendNow()
  const sendNowError = sendNowErrors[thread.id] ?? null
  const [replyState, setReplyState] = useState<{ canReply: boolean; replying: boolean }>({ canReply, replying: false })
  if (replyState.canReply !== canReply) setReplyState({ canReply, replying: false })
  const replying = replyState.replying
  const setReplying = (value: boolean) => setReplyState((prev) => ({ ...prev, replying: value }))
  const [pendingFocus, setPendingFocus] = useState<'reply' | 'draft-edit' | null>(null)

  useEffect(() => {
    if (!pendingFocus || !cardRef.current) return
    const selector = pendingFocus === 'reply' ? '.thread-card__reply-button' : '.thread-card__actions button'
    const button = cardRef.current.querySelector<HTMLButtonElement>(selector)
    if (button) {
      button.focus()
      setPendingFocus(null)
    }
  }, [pendingFocus, thread])

  const handleReplySave = (body: string) =>
    onReply(thread.id, body).then((result) => {
      setReplying(false)
      setPendingFocus('draft-edit')
      return result
    })

  const handleReplySendNow = (body: string) =>
    handleReplySave(body).then((result) => {
      sendNow(thread.id)
      return result
    })

  const handleReplyCancel = () => {
    setReplying(false)
    setPendingFocus('reply')
  }

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

  const handleResolve = (resolved: boolean) => {
    if (resolving) return
    setResolving(true)
    setResolveError(null)
    onResolve(thread.id, resolved)
      .then(() => {
        if (resolved) setShowResolved(false)
      })
      .catch((err: Error) => setResolveError(err.message))
      .finally(() => setResolving(false))
  }

  if (thread.resolved && !showResolved) {
    const firstLine = (thread.messages[0]?.body ?? '').split('\n')[0]
    return (
      <div ref={cardRef} id={threadCardId(thread.id)} tabIndex={-1} className="thread-card thread-card--resolved thread-card--collapsed">
        <div className="thread-card__header">
          <StatusChip status="resolved" />
          <span className="thread-card__anchor">{label}</span>
          <span className="thread-card__collapsed-text">{firstLine}</span>
          <span className="thread-card__header-actions">
            <Button variant="ghost" onClick={() => setShowResolved(true)} aria-label={`Show resolved thread on ${label}`}>
              Show
            </Button>
            <Button variant="ghost" onClick={() => handleResolve(false)} disabled={resolving} aria-label={`Reopen thread on ${label}`}>
              {resolving ? 'Reopening…' : 'Reopen'}
            </Button>
          </span>
        </div>
        {resolveError && <Note variant="failure">{resolveError}</Note>}
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      id={threadCardId(thread.id)}
      tabIndex={-1}
      className={`thread-card${isNewDraftThread ? ' thread-card--draft' : ''}${thread.resolved ? ' thread-card--resolved' : ''}`}
    >
      <div className="thread-card__header">
        <StatusChip status={status} unread={unread} />
        <span className="thread-card__anchor">{label}</span>
        <span className="thread-card__header-actions">
          {thread.resolved ? (
            <>
              <Button variant="ghost" onClick={() => setShowResolved(false)} aria-label={`Hide resolved thread on ${label}`}>
                Hide
              </Button>
              <Button variant="ghost" onClick={() => handleResolve(false)} disabled={resolving} aria-label={`Reopen thread on ${label}`}>
                {resolving ? 'Reopening…' : 'Reopen'}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => handleResolve(true)}
              disabled={resolving || inActiveRun}
              aria-label={`Resolve thread on ${label}`}
              title={inActiveRun ? 'Wait for the run to finish before resolving.' : undefined}
            >
              {resolving ? 'Resolving…' : 'Resolve'}
            </Button>
          )}
        </span>
      </div>
      {resolveError && <Note variant="failure">{resolveError}</Note>}
      {thread.messages.map((message) =>
        editingId === message.id ? (
          <div className="thread-card__draft-card" key={message.id}>
            <span className="thread-card__draft-title">Edit draft</span>
            <Composer
              initialBody={message.body}
              onSave={(body) => onSaveEdit(message.id, body, thread.anchor)}
              onCancel={() => onCancelEdit(thread.anchor)}
              ariaLabel={`Edit comment on ${label}`}
              hint
            />
          </div>
        ) : message.author === 'agent' ? (
          <AgentBubble key={message.id} message={message} />
        ) : (
          <div
            className={`thread-card__message${message.state === 'draft' && !isNewDraftThread ? ' thread-card__message--draft' : ''}`}
            key={message.id}
          >
            <Avatar initials={reviewerInitials} />
            <div className="thread-card__body-wrap">
              <p className="thread-card__body">{message.body}</p>
              {message.state === 'draft' && !thread.resolved && (
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
      {sendNowError && <Note variant="failure">{sendNowError}</Note>}
      {canReply &&
        !thread.resolved &&
        (replying ? (
          <div className="thread-card__draft-card">
            <span className="thread-card__draft-title">New reply</span>
            <Composer onSave={handleReplySave} onSendNow={handleReplySendNow} sendNowReason={sendNowReason} onCancel={handleReplyCancel} ariaLabel={`Reply on ${label}`} hint />
          </div>
        ) : (
          <Button className="thread-card__reply-button" variant="ghost" onClick={() => setReplying(true)} aria-label={`Reply on ${label}`}>
            Reply
          </Button>
        ))}
    </div>
  )
}

type PendingProps = {
  anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'>
  onSave: (body: string) => Promise<Review>
  onCancel: () => void
}

export function PendingThreadCard({ anchor, onSave, onCancel }: PendingProps) {
  const label = anchorLabel(anchor)
  const { reason: sendNowReason, sendNow } = useSendNow()
  const handleSendNow = (body: string) =>
    onSave(body).then((review) => {
      const id = newThreadId(review)
      if (id) sendNow(id)
      return review
    })
  return (
    <div className="thread-card thread-card--draft">
      <div className="thread-card__header">
        <span className="thread-card__draft-title">
          New draft · {label.charAt(0).toLowerCase()}
          {label.slice(1)}
        </span>
      </div>
      <Composer onSave={onSave} onSendNow={handleSendNow} sendNowReason={sendNowReason} onCancel={onCancel} ariaLabel={`Comment on ${label}`} hint />
    </div>
  )
}
