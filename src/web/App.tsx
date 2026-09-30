import { useEffect, useState } from 'react'
import type { ChangeSet, CommitDetails } from '../shared/api.ts'
import { client, unwrap } from './api.ts'
import { Note, Spinner } from './design-system'
import { shortSha } from './format.ts'
import { CommitHeader } from './review/CommitHeader.tsx'
import { Review } from './review/Review.tsx'

type Loaded = { commit: CommitDetails; changes: ChangeSet }

async function load(ref: string): Promise<Loaded> {
  const commit = await unwrap(client.api.commit.$get({ query: { ref } }))
  const base = commit.parents[0]
  const query = base ? { base, head: commit.sha } : { head: commit.sha }
  const changes = await unwrap(client.api.changes.$get({ query }))
  return { commit, changes }
}

function App() {
  const [review, setReview] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref') ?? 'HEAD'
    load(ref)
      .then(setReview)
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="app-status">
        <Note variant="failure">{error}</Note>
      </div>
    )
  }
  if (!review) {
    return (
      <p className="app-status">
        <Spinner /> Loading commit…
      </p>
    )
  }

  const { commit, changes } = review
  return (
    <Review
      key={commit.sha}
      reviewKey={commit.sha}
      changes={changes}
      header={<CommitHeader commit={commit} />}
      notice={
        commit.parents.length > 1 && (
          <Note>
            This is a merge commit. Changes are shown against its first parent,{' '}
            <code>{shortSha(commit.parents[0])}</code>.
          </Note>
        )
      }
    />
  )
}

export default App
