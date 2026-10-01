import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChangeSet, ReviewTarget } from '../shared/api.ts'
import { client, unwrap } from './api.ts'
import { Note, Spinner } from './design-system'
import { shortSha } from './format.ts'
import { CommitHeader } from './review/CommitHeader.tsx'
import { CompareHeader } from './review/CompareHeader.tsx'
import { Review } from './review/Review.tsx'
import { navigate, useSearch } from './router.ts'

type Target = { ref: string } | { base: string; head: string }

type Loaded = {
  params: Record<string, string>
  changes: ChangeSet
  header: ReactNode
  notice: ReactNode
  commits: string[]
  reviewTarget: ReviewTarget
}

function parseTarget(search: string): Target {
  const params = new URLSearchParams(search)
  const base = params.get('base')
  const head = params.get('head')
  if (base !== null || head !== null) return { base: base ?? '', head: head ?? '' }
  return { ref: params.get('ref') ?? 'HEAD' }
}

function targetKey(target: Target): string {
  return new URLSearchParams('ref' in target ? { ref: target.ref } : { base: target.base, head: target.head }).toString()
}

async function changesBetween(base: string | null, head: string): Promise<ChangeSet> {
  return unwrap(client.api.changes.$get({ query: base ? { base, head } : { head } }))
}

async function load(target: Target): Promise<Loaded> {
  if ('ref' in target) {
    const commit = await unwrap(client.api.commit.$get({ query: { ref: target.ref } }))
    const changes = await changesBetween(commit.parents[0] ?? null, commit.sha)
    return {
      params: { ref: commit.sha },
      changes,
      commits: [commit.sha],
      reviewTarget: { kind: 'commit', sha: commit.sha },
      header: <CommitHeader commit={commit} />,
      notice: commit.parents.length > 1 && (
        <Note>
          This is a merge commit. Changes are shown against its first parent, <code>{shortSha(commit.parents[0])}</code>.
        </Note>
      ),
    }
  }
  const comparison = await unwrap(client.api.compare.$get({ query: target }))
  const changes = await changesBetween(comparison.mergeBase ?? comparison.base.sha, comparison.head.sha)
  return {
    params: { base: comparison.base.sha, head: comparison.head.sha },
    changes,
    commits: [comparison.base.sha, comparison.head.sha],
    reviewTarget: { kind: 'compare', base: comparison.base.sha, head: comparison.head.sha },
    header: <CompareHeader comparison={comparison} />,
    notice: null,
  }
}

function openCommit(sha: string) {
  navigate({ ref: sha })
}

function App() {
  const target = parseTarget(useSearch())
  const key = targetKey(target)
  const [review, setReview] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const loadedKey = useRef<string | null>(null)
  const pending = review !== null && key !== targetKey(review.params as Target) && error?.key !== key

  useEffect(() => {
    if (key === loadedKey.current) return
    let cancelled = false
    load(parseTarget(key))
      .then((loaded) => {
        if (cancelled) return
        loadedKey.current = targetKey(loaded.params as Target)
        setReview(loaded)
        setError(null)
        window.scrollTo(0, 0)
        if (key !== loadedKey.current) navigate(loaded.params, { replace: true })
      })
      .catch((err: Error) => !cancelled && setError({ key, message: err.message }))
    return () => {
      cancelled = true
    }
  }, [key])

  if (error?.key === key) {
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
        <Spinner /> Loading…
      </p>
    )
  }

  return (
    <Review
      reviewKey={review.commits.join('..')}
      changes={review.changes}
      pending={pending}
      selectedCommits={review.commits}
      onSelectCommit={openCommit}
      header={review.header}
      notice={review.notice}
      reviewTarget={review.reviewTarget}
    />
  )
}

export default App
