import { useEffect, useState } from 'react'
import type { ApiError, RepoInfo } from '../shared/api.ts'
import './App.css'

function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/repo')
      .then(async (res) => {
        const body: RepoInfo | ApiError = await res.json()
        if ('error' in body) throw new Error(body.error)
        setRepo(body)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!repo) return <p>Loading…</p>

  return (
    <dl className="repo">
      <dt>Repository</dt>
      <dd><code>{repo.root}</code></dd>
      <dt>HEAD</dt>
      <dd><code>{repo.head ?? 'no commits yet'}</code></dd>
    </dl>
  )
}

export default App
