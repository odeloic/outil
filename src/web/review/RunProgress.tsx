import { useState } from 'react'
import type { Run } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { useModelLabel } from '../agents/useAgentModels.ts'
import { Button, Note, Spinner } from '../design-system'
import { useElapsedLabel } from './elapsed.ts'
import { useRunActivity } from './runActivity.ts'
import './RunProgress.css'

export function RunProgress({ run, onCancel }: { run: Run; onCancel: () => Promise<unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const modelLabel = useModelLabel(run.agent, run.model)
  const elapsed = useElapsedLabel(run.startedAt)
  const activity = useRunActivity(run.id)
  const latest = activity.at(-1) ?? null
  const threadCount = run.threadIds.length

  const handleCancel = () => {
    setCancelling(true)
    setCancelError(null)
    onCancel()
      .catch((err: unknown) => setCancelError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCancelling(false))
  }

  return (
    <div className="run-progress" id="review-run-progress">
      <div className="run-progress__header">
        <Spinner />
        <span className="run-progress__title">
          {AGENT_NAMES[run.agent]} · {modelLabel ?? run.model} is reviewing {threadCount} {threadCount === 1 ? 'thread' : 'threads'}
        </span>
        <span className="run-progress__elapsed">{elapsed}</span>
        <Button variant="ghost" onClick={handleCancel} disabled={cancelling} className="run-progress__cancel">
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
      {cancelError && <Note variant="failure">{cancelError}</Note>}
      {latest && (
        <p className="run-progress__activity-line" aria-live="polite">
          {latest.text}
        </p>
      )}
      {activity.length > 0 && (
        <Button variant="ghost" className="run-progress__toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'Hide activity' : 'Activity'}
        </Button>
      )}
      {expanded && (
        <ul className="run-progress__activity-list">
          {activity.map((event, index) => (
            <li key={`${event.at}-${index}`}>{event.text}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
