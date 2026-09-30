import type { InputHTMLAttributes, ReactNode } from 'react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
}

export function Checkbox({ label, disabled, className, ...rest }: CheckboxProps) {
  return (
    <label className={`ods-checkbox ${disabled ? 'ods-checkbox--disabled' : ''} ${className ?? ''}`}>
      <input type="checkbox" className="ods-checkbox__input" disabled={disabled} {...rest} />
      {label}
    </label>
  )
}
