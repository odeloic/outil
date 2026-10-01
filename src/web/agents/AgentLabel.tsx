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
  name,
  note,
  size = 'sm',
  compact = false,
}: {
  agent: AgentId
  model?: string | null
  effort?: string | null
  name?: string
  note?: string
  size?: Size
  compact?: boolean
}) {
  const modelLabel = useModelLabel(agent, model)
  return (
    <span className={`agent-label agent-label--${size}${compact ? ' agent-label--compact' : ''}`}>
      <AgentLogo agent={agent} label={AGENT_NAMES[agent]} size={size} />
      <span className="agent-label__text">
        <span className="agent-label__model">{name ?? modelLabel ?? model ?? AGENT_NAMES[agent]}</span>
        {effort && <span className="agent-label__effort">{effort}</span>}
        {note && <span className="agent-label__note">{note}</span>}
      </span>
    </span>
  )
}
