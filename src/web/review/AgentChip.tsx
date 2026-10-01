import type { Ref } from 'react'
import type { AgentId } from '../../shared/api.ts'
import { AgentLabel } from '../agents/AgentLabel.tsx'
import { Icon } from '../design-system'
import './AgentChip.css'

export function AgentChip({
  agent,
  model,
  effort,
  open,
  onToggle,
  controls,
  ref,
}: {
  agent: AgentId | null
  model: string | null
  effort: string | null
  open: boolean
  onToggle: () => void
  controls: string
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button ref={ref} type="button" className="agent-chip" aria-haspopup="dialog" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {agent ? <AgentLabel agent={agent} model={model} effort={effort} /> : <span className="agent-label__model">No agent</span>}
      <Icon name="chevron-down" />
    </button>
  )
}
