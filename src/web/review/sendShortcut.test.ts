import { describe, expect, it } from 'vitest'
import { createSendShortcut, SHORTCUT_COOLDOWN_MS, type ShortcutKeyEvent } from './sendShortcut.ts'

function press(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key: 'Enter', metaKey: true, ctrlKey: false, repeat: false, defaultPrevented: false, fromEditable: false, at: 10_000, ...overrides }
}

describe('send shortcut', () => {
  it('sends on a fresh command-enter outside an editable field', () => {
    expect(createSendShortcut().keyDown(press())).toBe(true)
  })

  it('also accepts control-enter', () => {
    expect(createSendShortcut().keyDown(press({ metaKey: false, ctrlKey: true }))).toBe(true)
  })

  it('ignores other keys and a missing modifier', () => {
    const shortcut = createSendShortcut()
    expect(shortcut.keyDown(press({ key: 'a' }))).toBe(false)
    expect(shortcut.keyDown(press({ metaKey: false }))).toBe(false)
  })

  it('does not send on key repeat, and sends once per press', () => {
    const shortcut = createSendShortcut()
    expect(shortcut.keyDown(press())).toBe(true)
    expect(shortcut.keyDown(press({ repeat: true }))).toBe(false)
    expect(shortcut.keyDown(press())).toBe(false)
    shortcut.keyUp('Enter')
    expect(shortcut.keyDown(press())).toBe(true)
  })

  it('never sends for a press that began in an editable field, even after repeats land elsewhere', () => {
    const shortcut = createSendShortcut()
    expect(shortcut.keyDown(press({ fromEditable: true }))).toBe(false)
    for (let i = 1; i <= 40; i++) expect(shortcut.keyDown(press({ repeat: true, at: 10_000 + i * 30 }))).toBe(false)
  })

  it('does not send right after a command-enter in an editable field, even as a new press', () => {
    const shortcut = createSendShortcut()
    shortcut.keyDown(press({ fromEditable: true }))
    shortcut.keyUp('Enter')
    expect(shortcut.keyDown(press({ at: 10_000 + SHORTCUT_COOLDOWN_MS - 1 }))).toBe(false)
    shortcut.keyUp('Enter')
    expect(shortcut.keyDown(press({ at: 10_000 + SHORTCUT_COOLDOWN_MS }))).toBe(true)
  })

  it('ignores a press another handler already consumed', () => {
    expect(createSendShortcut().keyDown(press({ defaultPrevented: true }))).toBe(false)
  })

  it('is released by the modifier keyup when the Enter keyup never arrives', () => {
    const shortcut = createSendShortcut()
    expect(shortcut.keyDown(press())).toBe(true)
    shortcut.keyUp('Meta')
    expect(shortcut.keyDown(press())).toBe(true)
  })

  it('is released by a window blur, and by control keyup', () => {
    const shortcut = createSendShortcut()
    expect(shortcut.keyDown(press())).toBe(true)
    shortcut.reset()
    expect(shortcut.keyDown(press({ metaKey: false, ctrlKey: true }))).toBe(true)
    shortcut.keyUp('Control')
    expect(shortcut.keyDown(press({ metaKey: false, ctrlKey: true }))).toBe(true)
  })
})
