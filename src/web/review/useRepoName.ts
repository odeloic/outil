import { useEffect, useState } from 'react'
import { client, unwrap } from '../api.ts'

export type RepoName = { name: string | null; error: string | null }

export function useRepoName(): RepoName {
  const [state, setState] = useState<RepoName>({ name: null, error: null })
  useEffect(() => {
    let cancelled = false
    unwrap(client.api.repo.$get())
      .then((info) => !cancelled && setState({ name: info.root.split('/').filter(Boolean).at(-1) ?? null, error: null }))
      .catch((err: Error) => !cancelled && setState({ name: null, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
