import type { AgentId } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { AgentLogo } from '../design-system'
import { useModelLabel } from './useAgentModels.ts'
import './AgentLabel.css'

type Size = 'xs' | 'sm' | 'md'

export function AgentLabel({
  agent,
  model = null,
  effort = null,
  note,
  size = 'sm',
  compact = false,
}: {
  agent: AgentId
  model?: string | null
  effort?: string | null
  note?: string
  size?: Size
  compact?: boolean
}) {
  const modelLabel = useModelLabel(agent, model)
  const shownModel = modelLabel ?? model
  return (
    <span className={`agent-label agent-label--${size}${compact ? ' agent-label--compact' : ''}`}>
      <AgentLogo size={size} />
      <span className="agent-label__text">
        <span className="agent-label__line">
          <span className="agent-label__name">{AGENT_NAMES[agent]}</span>
          {shownModel && <span className="agent-label__model">{shownModel}</span>}
          {note && <span className="agent-label__note">{note}</span>}
        </span>
        {effort && <span className="agent-label__effort">{effort}</span>}
      </span>
    </span>
  )
}
