import { useEffect, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'
import type { RepoInfo } from '../shared/api.ts'
import './App.css'

const client = hc<AppType>('/')

function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.api.repo.$get()
      .then(async (res) => {
        const body = await res.json()
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
