import type { ReactNode } from 'react'

export type NoteVariant = 'default' | 'hint' | 'failure'

export interface NoteProps {
  variant?: NoteVariant
  children: ReactNode
  action?: ReactNode
}

const VARIANT_CLASS: Record<NoteVariant, string> = {
  default: '',
  hint: 'ods-note--hint',
  failure: 'ods-note--failure',
}

export function Note({ variant = 'default', children, action }: NoteProps) {
  return (
    <div className={`ods-note ${VARIANT_CLASS[variant]}`}>
      <p className="ods-note__text">{children}</p>
      {action}
    </div>
  )
}
