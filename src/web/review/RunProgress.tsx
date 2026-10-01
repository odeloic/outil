import { useState } from 'react'
import type { Run } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { useModelLabel } from '../agents/useAgentModels.ts'
import { Button, Spinner } from '../design-system'
import { useElapsedLabel } from './elapsed.ts'
import { useRunActivity } from './runActivity.ts'
import './RunProgress.css'

export function RunProgress({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false)
  const modelLabel = useModelLabel(run.agent, run.model)
  const elapsed = useElapsedLabel(run.startedAt)
  const activity = useRunActivity(run.id)
  const latest = activity.at(-1) ?? null
  const threadCount = run.threadIds.length

  return (
    <div className="run-progress" id="review-run-progress">
      <div className="run-progress__header">
        <Spinner />
        <span className="run-progress__title">
          {AGENT_NAMES[run.agent]} · {modelLabel ?? run.model} is reviewing {threadCount} {threadCount === 1 ? 'thread' : 'threads'}
        </span>
        <span className="run-progress__elapsed">{elapsed}</span>
      </div>
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
