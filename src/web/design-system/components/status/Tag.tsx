import type { ReactNode } from 'react'

export interface TagProps {
  children: ReactNode
}

export function Tag({ children }: TagProps) {
  return <span className="ods-tag">{children}</span>
}
