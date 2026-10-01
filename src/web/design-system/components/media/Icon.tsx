export type IconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'arrow-swap'
  | 'arrow-up'
  | 'arrow-down'
  | 'layout'
  | 'check'
  | 'add'
  | 'warning'
  | 'loading'
  | 'comment-discussion'
  | 'agent'

export interface IconProps {
  name: IconName
  className?: string
}

export function Icon({ name, className }: IconProps) {
  const spin = name === 'loading' ? ' ods-icon--spin' : ''
  return <span className={`codicon codicon-${name} ods-icon${spin} ${className ?? ''}`} aria-hidden="true" />
}
