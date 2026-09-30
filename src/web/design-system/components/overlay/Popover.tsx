import type { ReactNode } from 'react'

export interface PopoverProps {
  static?: boolean
  children: ReactNode
  ariaLabel?: string
}

export function Popover({ static: isStatic = false, children, ariaLabel }: PopoverProps) {
  return (
    <div className={`ods-popover ${isStatic ? 'ods-popover--static' : ''}`} role="dialog" aria-label={ariaLabel}>
      {children}
    </div>
  )
}
