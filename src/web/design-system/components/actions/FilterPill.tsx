import type { ReactNode } from 'react'

export interface FilterPillProps {
  pressed: boolean
  onClick: () => void
  children: ReactNode
}

export function FilterPill({ pressed, onClick, children }: FilterPillProps) {
  return (
    <button type="button" className="ods-filter-pill" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}
