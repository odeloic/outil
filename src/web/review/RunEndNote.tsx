import { Button, Note, type NoteVariant } from '../design-system'

type Props = {
  variant: NoteVariant
  message: string
  actionLabel: string
  onAction: () => void
  pending?: boolean
  disabled?: boolean
}

export function RunEndNote({ variant, message, actionLabel, onAction, pending = false, disabled = false }: Props) {
  return (
    <Note
      variant={variant}
      action={
        <Button variant="default" onClick={onAction} disabled={pending || disabled}>
          {pending ? 'Sending…' : actionLabel}
        </Button>
      }
    >
      {message}
    </Note>
  )
}
