import type { ReactNode } from 'react'

export function renderFix(fix: string): ReactNode {
  return fix.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))
}
