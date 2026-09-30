import { SegmentedControl } from '../design-system'
import { updateDisplaySettings, useDisplaySettings } from '../settings.ts'
import './DisplayOptions.css'

export function DisplayOptions() {
  const { layout, wrap, theme } = useDisplaySettings()
  return (
    <div className="display-options">
      <SegmentedControl
        ariaLabel="Diff layout"
        value={layout}
        onChange={(value) => updateDisplaySettings({ layout: value })}
        options={[
          { value: 'unified', label: 'Unified' },
          { value: 'split', label: 'Split' },
        ]}
      />
      <SegmentedControl
        ariaLabel="Long lines"
        value={wrap ? 'wrap' : 'scroll'}
        onChange={(value) => updateDisplaySettings({ wrap: value === 'wrap' })}
        options={[
          { value: 'scroll', label: 'Scroll' },
          { value: 'wrap', label: 'Wrap' },
        ]}
      />
      <SegmentedControl
        ariaLabel="Appearance"
        value={theme}
        onChange={(value) => updateDisplaySettings({ theme: value })}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </div>
  )
}
