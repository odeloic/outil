import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentId, ChangeSet, Review as ReviewData, ReviewTarget, Run, Thread } from '../../shared/api.ts'
import { draftCount, threadStatus } from '../../shared/review.ts'
import { AgentLabel } from '../agents/AgentLabel.tsx'
import { AgentPicker } from '../agents/AgentPicker.tsx'
import { useAgentChoice } from '../agents/useAgentChoice.ts'
import { renderFix } from '../agents/fixText.tsx'
import { ApiRequestError } from '../api.ts'
import { FileDiffView } from '../diff/FileDiffView.tsx'
import { Button, CountBadge, Kbd, Note, Tabs, type NoteVariant } from '../design-system'
import { initials } from '../threads/initials.ts'
import { AgentChip } from './AgentChip.tsx'
import { DisplayOptions } from './DisplayOptions.tsx'
import { FileList } from './FileList.tsx'
import { HistoryList } from './HistoryList.tsx'
import { ThreadsList } from './ThreadsList.tsx'
import { unresolvedCount } from './threadGroups.ts'
import { adjacentOpenThread, focusThread, jumpToFile, orderOpenThreads, resetNavigation, useCurrentFile } from './navigation.ts'
import { RunEndNote } from './RunEndNote.tsx'
import { followNotReadyWatch, type NotReadyWatch } from './sendError.ts'
import { RunStack } from './RunStack.tsx'
import { SendNowProvider } from '../threads/SendNowProvider.tsx'
import { createSendShortcut } from './sendShortcut.ts'
import { useDismiss } from './useDismiss.ts'
import { ThemePill } from './ThemePill.tsx'
import { TopBar } from './TopBar.tsx'
import { useReview } from './useReview.ts'
import { useViewedFiles } from './viewed.ts'
import './Review.css'

type RailTab = 'files' | 'threads' | 'history'

const NO_THREADS: Thread[] = []
const NO_RUNS: Run[] = []
const END_NOTE_STATES = new Set<Run['state']>(['cancelled', 'failed', 'timed-out', 'interrupted'])
const RETRY_TITLE = 'Sends the threads still waiting for a reply, plus any drafts written since, to the current agent and model.'

function sendLabel(drafts: number): string {
  if (drafts === 0) return 'Send drafts'
  if (drafts === 1) return 'Send 1 draft'
  return `Send ${drafts} drafts`
}

function endNote(run: Run): { variant: NoteVariant; message: string; actionLabel: string } {
  switch (run.state) {
    case 'cancelled':
      return { variant: 'default', message: 'Run cancelled. Your comments are kept.', actionLabel: 'Send again' }
    case 'failed':
      return {
        variant: 'failure',
        message: run.errorKind === 'invalid' ? (run.error ?? 'Unknown error.') : `The agent failed: ${run.error ?? 'Unknown error.'}`,
        actionLabel: 'Retry',
      }
    case 'timed-out':
      return { variant: 'failure', message: run.error ?? 'The agent did not answer in time and was stopped.', actionLabel: 'Retry' }
    default:
      return { variant: 'failure', message: `Interrupted: ${run.error ?? 'Outil stopped before the agent answered.'}`, actionLabel: 'Retry' }
  }
}

function SendPanel({
  threads,
  drafts,
  runs,
  send,
  cancel,
  onJump,
}: {
  threads: Thread[]
  drafts: number
  runs: Run[]
  send: (agent: AgentId, model: string, effort: string | null, threadIds?: string[]) => Promise<ReviewData>
  cancel: (runId: string) => Promise<ReviewData>
  onJump: (thread: Thread) => void
}) {
  const { agent, agents, model, effort, agentsLoading, recheckAgents, modelsLoading, modelsError, stored } = useAgentChoice()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendErrorFix, setSendErrorFix] = useState<string | null>(null)
  const [notReadyWatch, setNotReadyWatch] = useState<NotReadyWatch | null>(null)
  const [seenChoice, setSeenChoice] = useState(stored)
  if (seenChoice !== stored) {
    setSeenChoice(stored)
    setSendError(null)
    setSendErrorFix(null)
    setNotReadyWatch(null)
  }
  const followed = followNotReadyWatch(notReadyWatch, agents)
  if (followed.clear) {
    setSendError(null)
    setSendErrorFix(null)
    setNotReadyWatch(null)
  } else if (followed.watch !== notReadyWatch) {
    setNotReadyWatch(followed.watch)
  }
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : null
  const noReplyCount = threads.filter((thread) => threadStatus(thread, runs) === 'failed').length

  const reason = !agent
    ? 'No agent is ready — open the agent menu.'
    : modelsLoading
      ? 'Loading models…'
      : modelsError
        ? modelsError
        : drafts === 0
          ? 'No drafts to send.'
          : null

  const canSend = reason === null && agent !== null && model !== null

  const handleSend = () => {
    if (!agent || !model || sending) return
    setPickerOpen(false)
    setOpen(true)
    setSending(true)
    setSendError(null)
    setSendErrorFix(null)
    setNotReadyWatch(null)
    send(agent, model, effort)
      .catch((err: unknown) => {
        setSendError(err instanceof Error ? err.message : String(err))
        const notReady = err instanceof ApiRequestError && err.status === 409 && err.fix ? err.fix : null
        setSendErrorFix(notReady)
        if (notReady) {
          setNotReadyWatch({ agent, sawNotReady: false })
          recheckAgents()
        }
      })
      .finally(() => setSending(false))
  }

  const latestRunId = latestRun?.id ?? null
  const latestRunState = latestRun?.state ?? null
  const latestRunErrorKind = latestRun?.errorKind ?? null
  useEffect(() => {
    if (latestRunId && latestRunState === 'failed' && (latestRunErrorKind === 'missing' || latestRunErrorKind === 'agent')) recheckAgents()
  }, [latestRunId, latestRunState, latestRunErrorKind, recheckAgents])

  const latestAgentStatus = latestRun ? agents.find((candidate) => candidate.id === latestRun.agent) : undefined
  const latestAgentFix = latestAgentStatus && latestAgentStatus.state !== 'ready' ? latestAgentStatus.fix : null

  const latestEndNote = latestRun && END_NOTE_STATES.has(latestRun.state) ? endNote(latestRun) : null
  const shownReason = latestEndNote && drafts === 0 ? null : reason
  const sendHint = sending ? null : shownReason

  const chipRef = useRef<HTMLButtonElement>(null)
  const sendButtonRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const closeRuns = useCallback(() => setOpen(false), [])
  useDismiss(pickerRef, pickerOpen, closePicker, chipRef)
  useDismiss(popoverRef, open, closeRuns, sendButtonRef)
  const focusPopover = useCallback((element: HTMLDivElement | null) => element?.focus(), [])

  const sendable = canSend && !sending
  const shortcut = useMemo(() => createSendShortcut(), [])
  const onShortcutSend = useEffectEvent(() => {
    if (sendable) handleSend()
  })
  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA' || element?.isContentEditable === true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const shouldSend = shortcut.keyDown({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        fromEditable: isEditable(event.target),
        at: event.timeStamp,
      })
      if (!shouldSend) return
      event.preventDefault()
      onShortcutSend()
    }
    const onKeyUp = (event: KeyboardEvent) => shortcut.keyUp(event.key)
    document.addEventListener('keydown', onKeyDown, true)
    const onBlur = () => shortcut.reset()
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [shortcut])

  return (
    <div className="review__send" ref={popoverRef}>
      <div className="review__chip" ref={pickerRef}>
        <AgentChip
          ref={chipRef}
          agent={agent}
          model={model}
          effort={effort}
          open={pickerOpen}
          onToggle={() => {
            setOpen(false)
            setPickerOpen((value) => !value)
          }}
          controls="review-agent-picker"
        />
        {pickerOpen && (
          <div className="review__picker">
            <AgentPicker id="review-agent-picker" />
          </div>
        )}
      </div>
      {runs.length > 0 && (
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls="review-send-popover"
          onClick={() => {
            setPickerOpen(false)
            setOpen((value) => !value)
          }}
        >
          Runs
          <CountBadge count={runs.length} />
        </Button>
      )}
      <div className="review__send-action">
        <Button
          ref={sendButtonRef}
          variant="primary"
          className="ods-btn--lg"
          onClick={() => {
            if (sendable) handleSend()
          }}
          aria-disabled={!sendable}
          aria-describedby="review-send-reason"
        >
          {sending ? 'Sending…' : sendLabel(drafts)}
          <Kbd>⌘↵</Kbd>
        </Button>
        <p id="review-send-reason" className="review__send-hint" role="status">
          {sendHint}
        </p>
      </div>
      {open && (
        <div id="review-send-popover" ref={focusPopover} tabIndex={-1} className="review__send-popover" role="dialog" aria-label="Agent runs">
          {agent && (
            <div className="review__send-popover-header">
              <AgentLabel agent={agent} model={model} effort={effort} size="md" />
              <span className="review__send-popover-drafts">{drafts === 1 ? '1 draft' : `${drafts} drafts`}</span>
            </div>
          )}
          {(shownReason || sendError || latestEndNote || (drafts > 0 && noReplyCount > 0)) && (
            <div className="review__send-popover-notes">
              {shownReason && <p className="review__send-reason">{shownReason}</p>}
              {drafts > 0 && noReplyCount > 0 && (
                <p className="review__send-reason">
                  Also re-sends {noReplyCount} {noReplyCount === 1 ? 'thread' : 'threads'} with no reply.
                </p>
              )}
              {sendError && (
                <Note
                  variant="failure"
                  action={
                    <Button variant="default" onClick={recheckAgents} disabled={agentsLoading}>
                      {agentsLoading ? 'Checking…' : 'Check again'}
                    </Button>
                  }
                >
                  {sendError}
                  {sendErrorFix && <span> {renderFix(sendErrorFix)}</span>}
                </Note>
              )}
              {latestEndNote && (
                <RunEndNote
                  variant={latestEndNote.variant}
                  message={latestEndNote.message}
                  fix={latestEndNote.variant === 'failure' ? latestAgentFix : null}
                  actionLabel={latestEndNote.actionLabel}
                  actionTitle={RETRY_TITLE}
                  onAction={handleSend}
                  pending={sending}
                  disabled={!agent || !model}
                />
              )}
            </div>
          )}
          <RunStack
            runs={runs}
            threads={threads}
            onCancel={cancel}
            onJump={(thread) => {
              setOpen(false)
              onJump(thread)
            }}
          />
        </div>
      )}
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
  const { review, error, reviewer, createThread, editDraft, deleteDraft, addFollowUp, resolveThread, send, cancel, markRead } =
    useReview(reviewTarget)
  const sendWithThreads = useCallback(
    (agent: AgentId, model: string, effort: string | null, threadIds: string[]) => send(agent, model, effort, threadIds),
    [send],
  )
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
  const threadTabCount = review ? unresolvedCount(review.threads) : 0
  const pathIndex = useMemo(() => new Map(changes.files.map((file, index) => [file.path, index])), [changes])
  const filePaths = useMemo(() => changes.files.map((file) => file.path), [changes])
  const openThreads = useMemo(() => (review ? orderOpenThreads(filePaths, review.threads) : []), [review, filePaths])
  const [navState, setNavState] = useState<{ key: string; thread: Thread | null }>({ key: reviewKey, thread: null })
  if (navState.key !== reviewKey) setNavState({ key: reviewKey, thread: null })
  const navThread = navState.key === reviewKey ? navState.thread : null

  useEffect(() => resetNavigation, [reviewKey])

  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setOverrides(({ key, map }) => ({ key, map: new Map(map).set(path, collapsed) }))
  }, [])

  const goToThread = useCallback(
    (thread: Thread) => {
      setNavState({ key: reviewKey, thread })
      setCollapsed(thread.anchor.path, false)
      const fileIndex = pathIndex.get(thread.anchor.path)
      if (fileIndex !== undefined) focusThread(thread.id, fileIndex)
    },
    [pathIndex, setCollapsed, reviewKey],
  )

  const goToOpenThread = useCallback(
    (direction: 1 | -1) => {
      const thread = adjacentOpenThread(filePaths, openThreads, navThread, direction)
      if (thread) goToThread(thread)
    },
    [filePaths, openThreads, navThread, goToThread],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[' && event.key !== ']') return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return
      event.preventDefault()
      goToOpenThread(event.key === ']' ? 1 : -1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [goToOpenThread])

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
    <SendNowProvider send={sendWithThreads}>
      <TopBar>
        <SendPanel threads={review?.threads ?? NO_THREADS} drafts={drafts} runs={runs} send={send} cancel={cancel} onJump={goToThread} />
      </TopBar>
      <div className="review">
        <aside className="review__rail">
          {error && <Note variant="failure">{error}</Note>}
          <Tabs<RailTab>
            tabs={[
              { key: 'files', label: 'Files', count: changes.files.length },
              { key: 'threads', label: 'Threads', count: threadTabCount, attention: threadTabCount > 0 },
              { key: 'history', label: 'History' },
            ]}
            active={railTab}
            onChange={setRailTab}
          />
          <div className="review__panel" role="tabpanel" aria-label="Files" hidden={railTab !== 'files'}>
            <FileList changes={changes} current={current} viewed={viewed} threadsByPath={threadsByPath} onSelect={jumpToFile} />
          </div>
          <div className="review__panel" role="tabpanel" aria-label="Threads" hidden={railTab !== 'threads'}>
            <ThreadsList filePaths={filePaths} threads={review?.threads ?? NO_THREADS} runs={runs} activeThreadId={navThread?.id ?? null} onJump={goToThread} />
          </div>
          <div className="review__panel" role="tabpanel" aria-label="History" hidden={railTab !== 'history'}>
            <HistoryList selected={selectedCommits} onSelect={onSelectCommit} />
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
          {header}
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
                onResolve={resolveThread}
              />
            )
          })}
        </main>
      </div>
      <ThemePill />
    </SendNowProvider>
  )
}
