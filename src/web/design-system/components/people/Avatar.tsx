export interface AvatarProps {
  initials: string
}

export function Avatar({ initials }: AvatarProps) {
  return (
    <span className="ods-avatar" aria-hidden="true">
      {initials}
    </span>
  )
}
