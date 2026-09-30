import { useEffect, useState } from 'react'

export function useProgressive(total: number, step: number, resetKey: unknown): number {
  const [state, setState] = useState({ key: resetKey, count: step })
  if (state.key !== resetKey) setState({ key: resetKey, count: step })
  const count = state.key === resetKey ? state.count : step

  useEffect(() => {
    if (count >= total) return
    const id = setTimeout(() => setState((s) => ({ key: s.key, count: s.count + step })), 0)
    return () => clearTimeout(id)
  }, [count, total, step])

  return Math.min(count, total)
}
