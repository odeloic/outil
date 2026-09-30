import { useRef, useState, type KeyboardEvent } from 'react'
import { Button, Kbd, Note, TextArea } from '../design-system'

type Props = {
  initialBody?: string
  onSave: (body: string) => Promise<unknown>
  onCancel: () => void
  autoFocus?: boolean
  ariaLabel: string
  hint?: boolean
}

export function Composer({ initialBody = '', onSave, onCancel, autoFocus = true, ariaLabel, hint = false }: Props) {
  const [value, setValue] = useState(initialBody)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  const save = () => {
    if (savingRef.current) return
    const trimmed = value.trim()
    if (trimmed === '') return
    savingRef.current = true
    setSaving(true)
    setError(null)
    onSave(trimmed).catch((err: Error) => {
      savingRef.current = false
      setSaving(false)
      setError(err.message)
    })
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
        <Button onClick={save} disabled={saving || value.trim() === ''}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
