import { useState } from 'react'
import type { Run, Thread } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { AgentLabel } from '../agents/AgentLabel.tsx'
import { Button, Icon, Note, ProgressBar, type IconName } from '../design-system'
import { relativeTime } from '../format.ts'
import { anchorLocation } from '../threads/anchorLabel.ts'
import { MessageBody } from '../threads/MessageBody.tsx'
import { RunProgress } from './RunProgress.tsx'
import './RunStack.css'

const STATE_ICON: Record<Run['state'], IconName> = {
  queued: 'loading',
  running: 'loading',
  done: 'check',
  cancelled: 'warning',
  failed: 'warning',
  'timed-out': 'warning',
  interrupted: 'warning',
}

const STATE_LABEL: Record<Run['state'], string> = {
  queued: 'Queued',
  running: 'Reviewing',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
  'timed-out': 'Timed out',
  interrupted: 'Interrupted',
}

function QueuedRun({ run, onCancel }: { run: Run; onCancel: (runId: string) => Promise<unknown> }) {
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadCount = run.threadIds.length
  const handleCancel = () => {
    setCancelling(true)
    setError(null)
    onCancel(run.id)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCancelling(false))
  }
  return (
    <>
      <p className="run-stack__state run-stack__state--queued">
        <Icon name={STATE_ICON.queued} />
        {STATE_LABEL.queued} · {threadCount} {threadCount === 1 ? 'thread' : 'threads'}
        <Button variant="ghost" onClick={handleCancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </p>
      {error && <Note variant="failure">{error}</Note>}
    </>
  )
}

const MAX_LOCATIONS = 3

function RunThreads({ run, threads, onJump }: { run: Run; threads: Thread[]; onJump: (thread: Thread) => void }) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const covered = run.threadIds.flatMap((id) => byId.get(id) ?? [])
  if (covered.length === 0) return null
  const hidden = covered.length - MAX_LOCATIONS
  return (
    <ul className="run-stack__threads" aria-label="Threads in this run">
      {covered.slice(0, MAX_LOCATIONS).map((thread) => (
        <li key={thread.id}>
          <Button variant="ghost" className="run-stack__location" onClick={() => onJump(thread)}>
            {anchorLocation(thread.anchor)}
          </Button>
        </li>
      ))}
      {hidden > 0 && <li className="run-stack__more">+{hidden} more</li>}
    </ul>
  )
}

type RunItemProps = { run: Run; threads: Thread[]; onCancel: (runId: string) => Promise<unknown>; onJump: (thread: Thread) => void }

function RunItem({ run, threads, onCancel, onJump }: RunItemProps) {
  const when = run.endedAt ?? run.startedAt
  return (
    <li className="run-stack__item">
      <div className="run-stack__header">
        <AgentLabel agent={run.agent} model={run.model} effort={run.effort} compact />
        <time className="run-stack__time" dateTime={when}>
          {relativeTime(when)}
        </time>
      </div>
      {run.state === 'queued' ? (
        <QueuedRun run={run} onCancel={onCancel} />
      ) : run.state === 'running' ? (
        <>
          <RunProgress run={run} onCancel={() => onCancel(run.id)} />
          <ProgressBar indeterminate label={`${AGENT_NAMES[run.agent]} is reviewing`} />
        </>
      ) : (
        <>
          <p className={`run-stack__state run-stack__state--${run.state}`}>
            <Icon name={STATE_ICON[run.state]} />
            {STATE_LABEL[run.state]}
          </p>
          {run.state === 'done' && run.summary && run.threadIds.length !== 1 && (
            <div className="run-stack__summary">
              <MessageBody body={run.summary} />
            </div>
          )}
        </>
      )}
      <RunThreads run={run} threads={threads} onJump={onJump} />
    </li>
  )
}

export function RunStack({ runs, threads, onCancel, onJump }: { runs: Run[]; threads: Thread[]; onCancel: (runId: string) => Promise<unknown>; onJump: (thread: Thread) => void }) {
  if (runs.length === 0) return null
  return (
    <ul className="run-stack" aria-label="Runs">
      {[...runs].reverse().map((run) => (
        <RunItem key={run.id} run={run} threads={threads} onCancel={onCancel} onJump={onJump} />
      ))}
    </ul>
  )
}
