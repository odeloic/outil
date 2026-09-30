export interface AvatarProps {
  kind: 'reviewer' | 'agent'
  initials?: string
}

export function Avatar({ kind, initials }: AvatarProps) {
  if (kind === 'agent') {
    return (
      <span className="ods-avatar ods-avatar--agent" aria-hidden="true">
        <span className="ods-dia" />
      </span>
    )
  }
  return (
    <span className="ods-avatar" aria-hidden="true">
      {initials}
    </span>
  )
}
