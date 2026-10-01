import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentId, ChangeSet, Review as ReviewData, ReviewTarget, Run, Thread } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { draftCount, threadStatus } from '../../shared/review.ts'
import { AgentPanel } from '../agents/AgentPanel.tsx'
import { useAgentChoice } from '../agents/useAgentChoice.ts'
import { useModelLabel } from '../agents/useAgentModels.ts'
import { FileDiffView } from '../diff/FileDiffView.tsx'
import { Avatar, Button, CountBadge, Note, Tabs } from '../design-system'
import { relativeTime } from '../format.ts'
import { initials } from '../threads/initials.ts'
import { DisplayOptions } from './DisplayOptions.tsx'
import { FileList } from './FileList.tsx'
import { HistoryList } from './HistoryList.tsx'
import { jumpToFile, resetNavigation, useCurrentFile } from './navigation.ts'
import { RunEndNote } from './RunEndNote.tsx'
import { RunProgress } from './RunProgress.tsx'
import { useReview } from './useReview.ts'
import { useViewedFiles } from './viewed.ts'
import './Review.css'

type RailTab = 'files' | 'history'

const NO_THREADS: Thread[] = []
const NO_RUNS: Run[] = []
const FAILURE_STATES = new Set<Run['state']>(['failed', 'timed-out', 'interrupted'])

function sendLabel(drafts: number): string {
  if (drafts === 0) return 'Send drafts'
  if (drafts === 1) return 'Send 1 draft'
  return `Send ${drafts} drafts`
}

function SendPanel({
  threads,
  drafts,
  runs,
  send,
  cancel,
}: {
  threads: Thread[]
  drafts: number
  runs: Run[]
  send: (agent: AgentId, model: string) => Promise<ReviewData>
  cancel: (runId: string) => Promise<ReviewData>
}) {
  const { agent, model, modelsLoading, modelsError } = useAgentChoice()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const runningRun = runs.find((run) => run.state === 'running') ?? null
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : null
  const latestRunModelLabel = useModelLabel(latestRun?.agent ?? null, latestRun?.model ?? null)
  const noReplyCount = threads.filter((thread) => threadStatus(thread, runs) === 'failed').length

  const reason = !agent
    ? 'No agent is ready — see Agents above.'
    : modelsLoading
      ? 'Loading models…'
      : modelsError
        ? modelsError
        : drafts === 0
          ? 'No drafts to send.'
          : runningRun
            ? 'Waiting for the agent…'
            : null

  const canSend = reason === null && agent !== null && model !== null

  const handleSend = () => {
    if (!agent || !model) return
    setSending(true)
    setSendError(null)
    send(agent, model)
      .catch((err: Error) => setSendError(err.message))
      .finally(() => setSending(false))
  }

  const endNoteShown = latestRun?.state === 'cancelled'
  const shownReason = endNoteShown && drafts === 0 ? null : reason
  const describedBy = runningRun ? 'review-run-progress' : shownReason ? 'review-send-reason' : undefined

  return (
    <div className="review__send">
      <Button variant="primary" onClick={handleSend} disabled={!canSend || sending} aria-describedby={describedBy}>
        {sending ? 'Sending…' : sendLabel(drafts)}
      </Button>
      {runningRun ? (
        <RunProgress run={runningRun} onCancel={() => cancel(runningRun.id)} />
      ) : (
        shownReason && (
          <p id="review-send-reason" className="review__send-reason">
            {shownReason}
          </p>
        )
      )}
      {drafts > 0 && noReplyCount > 0 && (
        <p className="review__send-reason">
          Also re-sends {noReplyCount} {noReplyCount === 1 ? 'thread' : 'threads'} with no reply.
        </p>
      )}
      {sendError && <Note variant="failure">{sendError}</Note>}
      {latestRun?.state === 'done' && (
        <div className="review__run-summary">
          <Avatar kind="agent" />
          <div className="review__run-summary-body">
            <p className="review__run-summary-header">
              {AGENT_NAMES[latestRun.agent]} · {latestRunModelLabel ?? latestRun.model}
              {latestRun.endedAt && <span className="review__run-summary-time"> · {relativeTime(latestRun.endedAt)}</span>}
            </p>
            {latestRun.summary && <p className="review__run-summary-text">{latestRun.summary}</p>}
          </div>
        </div>
      )}
      {endNoteShown && (
        <RunEndNote
          variant="default"
          message="Run cancelled. Your comments are kept."
          actionLabel="Send again"
          onAction={handleSend}
          pending={sending}
          disabled={!agent || !model}
        />
      )}
      {latestRun && FAILURE_STATES.has(latestRun.state) && <Note variant="failure">{latestRun.error ?? 'The run did not finish.'}</Note>}
    </div>
  )
}

type Props = {
  reviewKey: string
  changes: ChangeSet
  header: ReactNode
  notice?: ReactNode
  pending: boolean
  selectedCommits: string[]
  onSelectCommit: (sha: string) => void
  onCompare: (base: string, head: string) => void
  reviewTarget: ReviewTarget
}

export function Review({
  reviewKey,
  changes,
  header,
  notice,
  pending,
  selectedCommits,
  onSelectCommit,
  onCompare,
  reviewTarget,
}: Props) {
  const [viewed, setViewed] = useViewedFiles(reviewKey)
  const [overrides, setOverrides] = useState<{ key: string; map: ReadonlyMap<string, boolean> }>({
    key: reviewKey,
    map: new Map(),
  })
  if (overrides.key !== reviewKey) setOverrides({ key: reviewKey, map: new Map() })
  const collapsedOverrides = overrides.key === reviewKey ? overrides.map : new Map<string, boolean>()
  const [railTab, setRailTab] = useState<RailTab>('files')
  const current = useCurrentFile(changes.files.length)
  const { review, error, reviewer, createThread, editDraft, deleteDraft, addFollowUp, send, cancel, markRead } = useReview(reviewTarget)
  const reviewerInitials = useMemo(() => initials(reviewer), [reviewer])
  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>()
    for (const thread of review?.threads ?? []) {
      const list = map.get(thread.anchor.path)
      if (list) list.push(thread)
      else map.set(thread.anchor.path, [thread])
    }
    return map
  }, [review])
  const drafts = review ? draftCount(review) : 0
  const runs = review?.runs ?? NO_RUNS

  useEffect(() => resetNavigation, [reviewKey])

  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setOverrides(({ key, map }) => ({ key, map: new Map(map).set(path, collapsed) }))
  }, [])

  const markViewed = useCallback(
    (path: string, value: boolean) => {
      setViewed(path, value)
      setOverrides(({ key, map }) => {
        const next = new Map(map)
        next.delete(path)
        return { key, map: next }
      })
    },
    [setViewed],
  )

  const setAllCollapsed = (collapsed: boolean) => {
    setOverrides({ key: reviewKey, map: new Map(changes.files.map((file) => [file.path, collapsed])) })
  }

  return (
    <>
      {header}
      <div className="review">
        <aside className="review__rail">
          <div className="review__summary">
            <div className="review__summary-header">
              <span className="review__summary-title">Review</span>
              <CountBadge count={drafts} />
            </div>
            <p className="review__summary-text">{drafts === 0 ? 'No drafts' : `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} not sent`}</p>
            {error && <Note variant="failure">{error}</Note>}
            <AgentPanel />
            <SendPanel threads={review?.threads ?? NO_THREADS} drafts={drafts} runs={runs} send={send} cancel={cancel} />
          </div>
          <Tabs<RailTab>
            tabs={[
              { key: 'files', label: 'Files', count: changes.files.length },
              { key: 'history', label: 'History' },
            ]}
            active={railTab}
            onChange={setRailTab}
          />
          <div className="review__panel" role="tabpanel" aria-label="Files" hidden={railTab !== 'files'}>
            <FileList changes={changes} current={current} viewed={viewed} threadsByPath={threadsByPath} onSelect={jumpToFile} />
          </div>
          <div className="review__panel" role="tabpanel" aria-label="History" hidden={railTab !== 'history'}>
            <HistoryList selected={selectedCommits} onSelect={onSelectCommit} onCompare={onCompare} />
          </div>
        </aside>
        <main className="review__main" aria-busy={pending}>
          <div className="review__toolbar">
            <DisplayOptions />
            <span className="review__toolbar-actions">
              <Button variant="ghost" onClick={() => setAllCollapsed(true)}>
                Collapse all
              </Button>
              <Button variant="ghost" onClick={() => setAllCollapsed(false)}>
                Expand all
              </Button>
            </span>
          </div>
          {notice}
          {changes.files.length === 0 && <Note variant="hint">There are no changes to show.</Note>}
          {changes.files.map((file, index) => {
            const fileThreads = threadsByPath.get(file.path) ?? NO_THREADS
            return (
              <FileDiffView
                key={`${reviewKey}:${file.path}`}
                index={index}
                range={changes}
                file={file}
                collapsed={collapsedOverrides.get(file.path) ?? viewed.has(file.path)}
                viewed={viewed.has(file.path)}
                onCollapse={setCollapsed}
                onViewed={markViewed}
                threads={fileThreads}
                runs={fileThreads.length > 0 ? runs : NO_RUNS}
                reviewerInitials={reviewerInitials}
                onCreateThread={createThread}
                onEditDraft={editDraft}
                onDeleteDraft={deleteDraft}
                onReply={addFollowUp}
                onMarkRead={markRead}
              />
            )
          })}
        </main>
      </div>
    </>
  )
}
