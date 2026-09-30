import { useEffect, useState, type RefObject } from 'react'

export function useInView(ref: RefObject<Element | null>, rootMargin: string): boolean {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || seen) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin, seen])

  return seen
}
