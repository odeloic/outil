export interface ProgressBarProps {
  value: number
  max?: number
  label?: string
}

export function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="ods-progress">
      {label && <span>{label}</span>}
      <div className="ods-progress__track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <span className="ods-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
