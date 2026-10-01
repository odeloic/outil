import type { ReactNode } from 'react'

export interface MenuOptionProps {
  checked?: boolean
  disabled?: boolean
  onSelect?: () => void
  trailing?: ReactNode
  children: ReactNode
}

export function MenuOption({ checked, disabled, onSelect, trailing, children }: MenuOptionProps) {
  return (
    <button
      type="button"
      className="ods-menu-option"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span>{children}</span>
      {trailing && <span className="ods-menu-option__trailing">{trailing}</span>}
    </button>
  )
}
