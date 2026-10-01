import { useCallback, useRef, useState } from 'react'
import { Button, Icon, SegmentedControl } from '../design-system'
import { updateDisplaySettings, useDisplaySettings } from '../settings.ts'
import { useDismiss } from './useDismiss.ts'
import './DisplayOptions.css'

export function DisplayOptions() {
  const { layout, wrap } = useDisplaySettings()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close, buttonRef)
  const focusPopover = useCallback((element: HTMLDivElement | null) => element?.focus(), [])
  return (
    <div className="display-options" ref={ref}>
      <Button ref={buttonRef} className="display-options__button" aria-haspopup="dialog" aria-expanded={open} aria-controls="display-options-popover" onClick={() => setOpen((value) => !value)}>
        <Icon name="layout" />
        View
        <Icon name="chevron-down" />
      </Button>
      {open && (
        <div id="display-options-popover" ref={focusPopover} tabIndex={-1} className="display-options__popover" role="dialog" aria-label="View options">
          <div className="display-options__field">
            <span className="display-options__label">Layout</span>
            <SegmentedControl
              ariaLabel="Diff layout"
              value={layout}
              onChange={(value) => updateDisplaySettings({ layout: value })}
              options={[
                { value: 'unified', label: 'Unified' },
                { value: 'split', label: 'Split' },
              ]}
            />
          </div>
          <div className="display-options__field">
            <span className="display-options__label">Long lines</span>
            <SegmentedControl
              ariaLabel="Long lines"
              value={wrap ? 'wrap' : 'scroll'}
              onChange={(value) => updateDisplaySettings({ wrap: value === 'wrap' })}
              options={[
                { value: 'scroll', label: 'Scroll' },
                { value: 'wrap', label: 'Wrap' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  )
}
