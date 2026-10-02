import { useRef, useState, type KeyboardEvent } from 'react'
import { Button, Kbd, Note, TextArea } from '../design-system'

type Props = {
  initialBody?: string
  onSave: (body: string) => Promise<unknown>
  onSendNow?: (body: string) => Promise<unknown>
  sendNowReason?: string | null
  onCancel: () => void
  autoFocus?: boolean
  ariaLabel: string
  hint?: boolean
}

export function Composer({ initialBody = '', onSave, onSendNow, sendNowReason = null, onCancel, autoFocus = true, ariaLabel, hint = false }: Props) {
  const [value, setValue] = useState(initialBody)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  const submit = (action: (body: string) => Promise<unknown>) => {
    if (savingRef.current) return
    const trimmed = value.trim()
    if (trimmed === '') return
    savingRef.current = true
    setSaving(true)
    setError(null)
    action(trimmed).catch((err: Error) => {
      savingRef.current = false
      setSaving(false)
      setError(err.message)
    })
  }

  const save = () => submit(onSave)
  const sendNow = () => {
    if (onSendNow) submit(onSendNow)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (!savingRef.current) onCancel()
    }
  }

  return (
    <div className="composer">
      <TextArea
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {hint && (
        <p className="composer__hint">
          <Kbd>Shift</Kbd> + click another line to comment on a range
        </p>
      )}
      {error && <Note variant="failure">{error}</Note>}
      <div className="composer__actions">
        <Button variant="primary" onClick={save} disabled={saving || value.trim() === ''}>
          {saving ? 'Saving…' : 'Save draft'}
          <Kbd>⌘↵</Kbd>
        </Button>
        {onSendNow && (
          <Button
            variant="default"
            onClick={sendNow}
            disabled={saving || value.trim() === '' || sendNowReason !== null}
            title={sendNowReason ?? 'Saves this draft and sends this thread to the agent now.'}
          >
            Send now
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  )
}
