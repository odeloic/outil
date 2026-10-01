import { useEffect, useState, type RefObject } from 'react'

export function useVisibleFor(ref: RefObject<Element | null>, ms: number, active: boolean): boolean {
  const [done, setDone] = useState(false)
  const [prevActive, setPrevActive] = useState(active)

  if (active !== prevActive) {
    setPrevActive(active)
    if (!active) setDone(false)
  }

  useEffect(() => {
    if (!active || done) return
    const element = ref.current
    if (!element) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      if (visible) {
        timer = setTimeout(() => setDone(true), ms)
      } else if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [ref, ms, active, done])

  return done
}
