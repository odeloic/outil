import type { KeyboardEvent } from 'react'

export function moveBetweenOptions(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
  if (options.length === 0) return
  event.preventDefault()
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  options[(index + step + options.length) % options.length].focus()
}
