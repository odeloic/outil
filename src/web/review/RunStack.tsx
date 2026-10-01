import type { Run } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { AgentLabel } from '../agents/AgentLabel.tsx'
import { Icon, ProgressBar, type IconName } from '../design-system'
import { relativeTime } from '../format.ts'
import { MessageBody } from '../threads/MessageBody.tsx'
import { RunProgress } from './RunProgress.tsx'
import './RunStack.css'

const STATE_ICON: Record<Run['state'], IconName> = {
  running: 'loading',
  done: 'check',
  cancelled: 'warning',
  failed: 'warning',
  'timed-out': 'warning',
  interrupted: 'warning',
}

const STATE_LABEL: Record<Run['state'], string> = {
  running: 'Reviewing',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
  'timed-out': 'Timed out',
  interrupted: 'Interrupted',
}

function RunItem({ run, onCancel }: { run: Run; onCancel: (runId: string) => Promise<unknown> }) {
  const when = run.endedAt ?? run.startedAt
  return (
    <li className="run-stack__item">
      <div className="run-stack__header">
        <AgentLabel agent={run.agent} model={run.model} effort={run.effort} compact />
        <time className="run-stack__time" dateTime={when}>
          {relativeTime(when)}
        </time>
      </div>
      {run.state === 'running' ? (
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
          {run.state === 'done' && run.summary && (
            <div className="run-stack__summary">
              <MessageBody body={run.summary} />
            </div>
          )}
        </>
      )}
    </li>
  )
}

export function RunStack({ runs, onCancel }: { runs: Run[]; onCancel: (runId: string) => Promise<unknown> }) {
  if (runs.length === 0) return null
  return (
    <ul className="run-stack" aria-label="Runs">
      {[...runs].reverse().map((run) => (
        <RunItem key={run.id} run={run} onCancel={onCancel} />
      ))}
    </ul>
  )
}
