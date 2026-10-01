export interface SegmentedOption<Value extends string = string> {
  value: Value
  label: string
  disabled?: boolean
}

export interface SegmentedControlProps<Value extends string = string> {
  options: SegmentedOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  ariaLabel?: string
  compact?: boolean
}

export function SegmentedControl<Value extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  compact = false,
}: SegmentedControlProps<Value>) {
  return (
    <span className={`ods-seg${compact ? ' ods-seg--compact' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ods-seg__btn"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}
