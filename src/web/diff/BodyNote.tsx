import type { ReactNode } from 'react'
import { Note, type NoteVariant } from '../design-system'

export function BodyNote({
  variant = 'hint',
  action,
  children,
}: {
  variant?: NoteVariant
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="file-diff__note">
      <Note variant={variant} action={action}>
        {children}
      </Note>
    </div>
  )
}
