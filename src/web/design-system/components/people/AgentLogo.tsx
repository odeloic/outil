import { Icon } from '../media/Icon.tsx'

export interface AgentLogoProps {
  size?: 'md' | 'sm' | 'xs'
}

export function AgentLogo({ size = 'sm' }: AgentLogoProps) {
  const sizeClass = size === 'sm' ? '' : ` ods-agent-logo--${size}`
  return (
    <span className={`ods-agent-logo${sizeClass}`} aria-hidden="true">
      <Icon name="agent" />
    </span>
  )
}
