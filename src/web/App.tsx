import { useEffect, useRef, useState } from 'react'
import type { ChangeSet, CommitDetails } from '../shared/api.ts'
import { client, unwrap } from './api.ts'
import { Note, Spinner } from './design-system'
import { shortSha } from './format.ts'
import { CommitHeader } from './review/CommitHeader.tsx'
import { Review } from './review/Review.tsx'
import { navigate, useSearch } from './router.ts'

type Loaded = { commit: CommitDetails; changes: ChangeSet }

async function load(ref: string): Promise<Loaded> {
  const commit = await unwrap(client.api.commit.$get({ query: { ref } }))
  const base = commit.parents[0]
  const query = base ? { base, head: commit.sha } : { head: commit.sha }
  const changes = await unwrap(client.api.changes.$get({ query }))
  return { commit, changes }
}

function openCommit(sha: string) {
  navigate({ ref: sha })
}

function App() {
  const ref = new URLSearchParams(useSearch()).get('ref') ?? 'HEAD'
  const [review, setReview] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ ref: string; message: string } | null>(null)
  const loadedSha = useRef<string | null>(null)
  const pending = review !== null && ref !== review.commit.sha && error?.ref !== ref

  useEffect(() => {
    if (ref === loadedSha.current) return
    let cancelled = false
    load(ref)
      .then((loaded) => {
        if (cancelled) return
        loadedSha.current = loaded.commit.sha
        setReview(loaded)
        setError(null)
        window.scrollTo(0, 0)
        if (ref !== loaded.commit.sha) navigate({ ref: loaded.commit.sha }, { replace: true })
      })
      .catch((err: Error) => !cancelled && setError({ ref, message: err.message }))
    return () => {
      cancelled = true
    }
  }, [ref])

  if (error?.ref === ref) {
    return (
      <div className="app-status">
        <Note variant="failure" action={<a href="?">Open the latest commit</a>}>
          {error.message}
        </Note>
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
      reviewKey={commit.sha}
      changes={changes}
      pending={pending}
      selectedCommit={commit.sha}
      onSelectCommit={openCommit}
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
