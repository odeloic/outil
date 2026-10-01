import { useEffect, useState } from 'react'
import type { RefList } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'

export type RefsState = { refs: RefList | null; error: string | null }

export function useRefs(): RefsState {
  const [state, setState] = useState<RefsState>({ refs: null, error: null })
  useEffect(() => {
    let cancelled = false
    unwrap(client.api.refs.$get())
      .then((refs) => !cancelled && setState({ refs, error: null }))
      .catch((err: Error) => !cancelled && setState({ refs: null, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

export function refNameFor(refs: RefList | null, sha: string): string | null {
  if (!refs) return null
  const branches = refs.branches.filter((entry) => entry.sha === sha)
  const current = branches.find((entry) => entry.name === refs.current)
  return (current ?? branches[0] ?? refs.tags.find((entry) => entry.sha === sha))?.name ?? null
}
