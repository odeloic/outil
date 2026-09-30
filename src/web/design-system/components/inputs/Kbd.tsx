import type { ReactNode } from 'react'

export interface KbdProps {
  children: ReactNode
}

export function Kbd({ children }: KbdProps) {
  return <span className="ods-kbd">{children}</span>
}
