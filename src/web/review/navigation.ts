import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Thread } from '../../shared/api.ts'
import { isOpenThread } from '../../shared/review.ts'

export function revealInScrollParent(element: HTMLElement) {
  let parent = element.parentElement
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
  if (!parent) return
  const box = element.getBoundingClientRect()
  const view = parent.getBoundingClientRect()
  if (box.top < view.top) parent.scrollTop -= view.top - box.top
  else if (box.bottom > view.bottom) parent.scrollTop += box.bottom - view.bottom
}

export function fileAnchor(index: number): string {
  return `file-${index}`
}

function sections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-file-index]')]
}

const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown'] as const
const SETTLE_LIMIT_MS = 8000
const SETTLED_AFTER_MS = 600

let pinned: number | null = null
const pinListeners = new Set<() => void>()

function setPinned(index: number | null) {
  pinned = index
  pinListeners.forEach((listener) => listener())
}

function subscribePinned(listener: () => void) {
  pinListeners.add(listener)
  return () => pinListeners.delete(listener)
}

function topmostSection(): number {
  const all = sections()
  let low = 0
  let high = all.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (all[mid].getBoundingClientRect().bottom > 1) high = mid
    else low = mid + 1
  }
  return low
}

export function useCurrentFile(count: number): number {
  const [current, setCurrent] = useState(0)
  const jumpedTo = useSyncExternalStore(subscribePinned, () => pinned)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setCurrent(topmostSection())
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    const resize = new ResizeObserver(schedule)
    resize.observe(document.body)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      resize.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [count])

  return jumpedTo !== null && jumpedTo < count ? jumpedTo : current
}

function loadingJustAbove(target: HTMLElement): boolean {
  const top = target.getBoundingClientRect().top
  const reach = 2 * window.innerHeight
  for (const loading of document.querySelectorAll('.file-diff__loading')) {
    const loadingTop = loading.getBoundingClientRect().top
    if (loadingTop <= top && loadingTop >= top - reach) return true
  }
  return false
}

let activeJump = 0

export function resetNavigation() {
  activeJump++
  setPinned(null)
}

export function jumpToFile(index: number) {
  const target = document.getElementById(fileAnchor(index))
  if (!target) return
  const jump = ++activeJump
  target.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
  setPinned(index)

  const started = performance.now()
  let stableSince = started
  let lastTop = target.getBoundingClientRect().top
  const release = () => {
    USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, release))
    window.removeEventListener('scroll', release)
    if (jump !== activeJump) return
    activeJump++
    setPinned(null)
  }
  USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, release, { passive: true }))

  const settle = () => {
    if (jump !== activeJump) return
    const now = performance.now()
    const top = target.getBoundingClientRect().top
    if (Math.abs(top - lastTop) > 1 || loadingJustAbove(target)) stableSince = now
    lastTop = top
    if (now - started > SETTLE_LIMIT_MS || now - stableSince > SETTLED_AFTER_MS) {
      requestAnimationFrame(() => window.addEventListener('scroll', release, { passive: true, once: true }))
      return
    }
    if (Math.abs(top) > 1) {
      window.scrollBy(0, top)
      lastTop = target.getBoundingClientRect().top
    }
    requestAnimationFrame(settle)
  }
  requestAnimationFrame(settle)
}

function threadOrder(filePaths: readonly string[]): (a: Thread, b: Thread) => number {
  const fileIndex = new Map(filePaths.map((path, index) => [path, index]))
  return (a, b) => {
    const fa = fileIndex.get(a.anchor.path) ?? filePaths.length
    const fb = fileIndex.get(b.anchor.path) ?? filePaths.length
    if (fa !== fb) return fa - fb
    if (a.anchor.endLine !== b.anchor.endLine) return a.anchor.endLine - b.anchor.endLine
    if (a.anchor.side !== b.anchor.side) return a.anchor.side === 'old' ? -1 : 1
    return 0
  }
}

export function orderOpenThreads(filePaths: readonly string[], threads: readonly Thread[]): Thread[] {
  return threads.filter(isOpenThread).slice().sort(threadOrder(filePaths))
}

export function adjacentOpenThread(
  filePaths: readonly string[],
  ordered: readonly Thread[],
  current: Thread | null,
  direction: 1 | -1,
): Thread | null {
  if (ordered.length === 0) return null
  if (!current) return direction === 1 ? ordered[0] : ordered[ordered.length - 1]
  const at = ordered.findIndex((thread) => thread.id === current.id)
  if (at !== -1) return ordered[(at + direction + ordered.length) % ordered.length]
  const compare = threadOrder(filePaths)
  if (direction === 1) return ordered.find((thread) => compare(thread, current) > 0) ?? ordered[0]
  return [...ordered].reverse().find((thread) => compare(thread, current) < 0) ?? ordered[ordered.length - 1]
}

export function threadCardId(id: string): string {
  return `thread-${id}`
}

export function focusThread(id: string, fileIndex: number) {
  const section = document.getElementById(fileAnchor(fileIndex))
  if (section) section.scrollIntoView({ block: 'start' })
  const started = performance.now()
  const poll = () => {
    const el = document.getElementById(threadCardId(id))
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.focus({ preventScroll: true })
      return
    }
    if (performance.now() - started > SETTLE_LIMIT_MS) return
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
}
