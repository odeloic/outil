export interface ProgressBarProps {
  value?: number
  max?: number
  label?: string
  indeterminate?: boolean
}

export function ProgressBar({ value = 0, max = 100, label, indeterminate = false }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="ods-progress">
      {label && <span className={indeterminate ? 'visually-hidden' : undefined}>{label}</span>}
      <div
        className={`ods-progress__track${indeterminate ? ' ods-progress__track--indeterminate' : ''}`}
        role="progressbar"
        aria-label={indeterminate ? label : undefined}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <span className="ods-progress__fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  )
}
