import { useEffect, useState } from 'react'
import type { CommitDetails } from '../shared/api.ts'
import { client, unwrap } from './api.ts'
import { Note, Spinner } from './design-system'
import { CommitHeader } from './review/CommitHeader.tsx'

function App() {
  const [commit, setCommit] = useState<CommitDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref') ?? 'HEAD'
    unwrap(client.api.commit.$get({ query: { ref } }))
      .then(setCommit)
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="app-status">
        <Note variant="failure">{error}</Note>
      </div>
    )
  }
  if (!commit) {
    return (
      <p className="app-status">
        <Spinner /> Loading commit…
      </p>
    )
  }

  return <CommitHeader commit={commit} />
}

export default App
