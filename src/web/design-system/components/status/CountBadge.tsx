export interface CountBadgeProps {
  count: number | string
  attention?: boolean
  title?: string
}

export function CountBadge({ count, attention = false, title }: CountBadgeProps) {
  return (
    <span className={`ods-count ${attention ? 'ods-count--attention' : ''}`} title={title}>
      {count}
    </span>
  )
}
