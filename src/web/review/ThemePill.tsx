import { updateDisplaySettings, useDisplaySettings } from '../settings.ts'
import './ThemePill.css'

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export function ThemePill() {
  const { theme } = useDisplaySettings()
  return (
    <div className="theme-pill" role="group" aria-label="Appearance">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="theme-pill__option"
          aria-pressed={theme === option.value}
          onClick={() => updateDisplaySettings({ theme: option.value })}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
