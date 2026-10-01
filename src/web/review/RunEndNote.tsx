import { useState } from 'react'
import { renderFix } from '../agents/fixText.tsx'
import { Button, Note, type NoteVariant } from '../design-system'
import './RunEndNote.css'

const TRIM_LENGTH = 500

type Props = {
  variant: NoteVariant
  message: string
  fix?: string | null
  actionLabel: string
  actionTitle?: string
  onAction: () => void
  pending?: boolean
  disabled?: boolean
}

export function RunEndNote({
  variant,
  message,
  fix,
  actionLabel,
  actionTitle,
  onAction,
  pending = false,
  disabled = false,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const long = message.length > TRIM_LENGTH
  const shown = long && !expanded ? `${message.slice(0, TRIM_LENGTH).trimEnd()}…` : message

  return (
    <Note
      variant={variant}
      action={
        <Button variant="default" onClick={onAction} disabled={pending || disabled} title={actionTitle}>
          {pending ? 'Sending…' : actionLabel}
        </Button>
      }
    >
      <span className="run-end-note__body">
        {shown}
        {long && (
          <Button
            variant="ghost"
            className="run-end-note__toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </Button>
        )}
        {fix && <span className="run-end-note__fix"> {renderFix(fix)}</span>}
      </span>
    </Note>
  )
}
