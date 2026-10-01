import { Icon } from '../media/Icon.tsx'

export interface SpinnerProps {
  className?: string
}

export function Spinner({ className }: SpinnerProps) {
  return (
    <span className={`ods-spinner ${className ?? ''}`} role="status" aria-label="Loading">
      <Icon name="loading" />
    </span>
  )
}
