export type ShortcutKeyEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  repeat: boolean
  defaultPrevented: boolean
  fromEditable: boolean
  at: number
}

export const SHORTCUT_COOLDOWN_MS = 800

export function createSendShortcut() {
  let held = false
  let lastEditableAt = Number.NEGATIVE_INFINITY

  return {
    keyDown(event: ShortcutKeyEvent): boolean {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false
      if (event.fromEditable) {
        held = true
        lastEditableAt = event.at
        return false
      }
      if (event.repeat || event.defaultPrevented || held) return false
      if (event.at - lastEditableAt < SHORTCUT_COOLDOWN_MS) return false
      held = true
      return true
    },
    keyUp(key: string) {
      if (key === 'Enter' || key === 'Meta' || key === 'Control') held = false
    },
    reset() {
      held = false
    },
  }
}
