import { useEffect, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'
import type { RepoInfo, ResolvedCommit } from '../shared/api.ts'
import './App.css'

const client = hc<AppType>('/')

async function load(ref: string): Promise<[RepoInfo, ResolvedCommit]> {
  const [repoRes, commitRes] = await Promise.all([
    client.api.repo.$get(),
    client.api.resolve.$get({ query: { ref } }),
  ])
  const repo = await repoRes.json()
  if ('error' in repo) throw new Error(repo.error)
  const commit = await commitRes.json()
  if ('error' in commit) throw new Error(commit.error)
  return [repo, commit]
}

function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [commit, setCommit] = useState<ResolvedCommit | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref') ?? 'HEAD'
    load(ref)
      .then(([repoBody, commitBody]) => {
        setRepo(repoBody)
        setCommit(commitBody)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!repo || !commit) return <p>Loading…</p>

  return (
    <dl className="repo">
      <dt>Repository</dt>
      <dd><code>{repo.root}</code></dd>
      <dt>Reference</dt>
      <dd><code>{commit.ref}</code></dd>
      <dt>Commit</dt>
      <dd><code>{commit.sha}</code></dd>
    </dl>
  )
}

export default App
