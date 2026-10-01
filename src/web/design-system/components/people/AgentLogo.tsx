import claudeIcon from '../../assets/agents/claude-icon-rounded.svg'
import openaiBlack from '../../assets/agents/openai-blossom-black.svg'
import openaiWhite from '../../assets/agents/openai-blossom-white.svg'

export type AgentLogoAgent = 'claude' | 'codex'

export interface AgentLogoProps {
  agent: AgentLogoAgent
  label: string
  size?: 'md' | 'sm' | 'xs'
}

export function AgentLogo({ agent, label, size = 'sm' }: AgentLogoProps) {
  const sizeClass = size === 'sm' ? '' : ` ods-agent-logo--${size}`
  if (agent === 'claude') {
    return <img className={`ods-agent-logo ods-agent-logo--claude${sizeClass}`} src={claudeIcon} alt={label} />
  }
  return (
    <span className={`ods-agent-logo ods-agent-logo--codex${sizeClass}`} role="img" aria-label={label}>
      <img className="ods-agent-logo__mark ods-agent-logo__mark--on-dark" src={openaiWhite} alt="" />
      <img className="ods-agent-logo__mark ods-agent-logo__mark--on-light" src={openaiBlack} alt="" />
    </span>
  )
}
