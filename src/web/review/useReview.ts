import { useCallback, useEffect, useRef, useState } from 'react'
import type { Review, ReviewTarget, ThreadAnchor } from '../../shared/api.ts'
import { ApiRequestError, client, unwrap } from '../api.ts'

export function targetKey(target: ReviewTarget): string {
  return target.kind === 'commit' ? target.sha : `${target.base}..${target.head}`
}

type KeyedReview = { key: string; review: Review }

export function pickReview(prev: KeyedReview | null, key: string, review: Review): KeyedReview {
  if (prev && prev.key === key && prev.review.generation === review.generation && prev.review.revision >= review.revision) return prev
  return { key, review }
}

const MESSAGE_GONE = 'This comment no longer exists.'

export type UseReview = {
  review: Review | null
  error: string | null
  reviewer: string | null
  createThread: (anchor: ThreadAnchor, body: string) => Promise<Review>
  editDraft: (id: string, body: string) => Promise<Review>
  deleteDraft: (id: string) => Promise<Review>
}

export function useReview(target: ReviewTarget): UseReview {
  const key = targetKey(target)
  const [state, setState] = useState<KeyedReview | null>(null)
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null)
  const [reviewer, setReviewer] = useState<string | null>(null)
  const targetRef = useRef(target)

  useEffect(() => {
    targetRef.current = target
  })

  const applyResponse = useCallback((dispatchKey: string, review: Review) => {
    if (targetKey(targetRef.current) !== dispatchKey) return
    setState((prev) => pickReview(prev, dispatchKey, review))
    setErrorState((prev) => (prev && prev.key === dispatchKey ? null : prev))
  }, [])

  const fetchReview = useCallback(
    (dispatchKey: string) => {
      const current = targetRef.current
      const query = current.kind === 'commit' ? { commit: current.sha } : { base: current.base, head: current.head }
      return unwrap(client.api.review.$get({ query })).then(
        (body) => {
          applyResponse(dispatchKey, body)
          return body
        },
        (err: Error) => {
          if (targetKey(targetRef.current) !== dispatchKey) return undefined
          setErrorState({ key: dispatchKey, message: err.message })
          return undefined
        },
      )
    },
    [applyResponse],
  )

  useEffect(() => {
    fetchReview(key)
  }, [key, fetchReview])

  useEffect(() => {
    let cancelled = false
    unwrap(client.api.repo.$get())
      .then((info) => !cancelled && setReviewer(info.reviewer))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const applyMutation = useCallback(
    (promise: Promise<Review>, notFoundMessage?: string) => {
      const dispatchKey = targetKey(targetRef.current)
      return promise.then(
        (next) => {
          applyResponse(dispatchKey, next)
          return next
        },
        (err: unknown) => {
          if (notFoundMessage && err instanceof ApiRequestError && err.status === 404) {
            void fetchReview(dispatchKey)
            throw new Error(notFoundMessage)
          }
          throw err
        },
      )
    },
    [applyResponse, fetchReview],
  )

  const createThread = useCallback(
    (anchor: ThreadAnchor, body: string) =>
      applyMutation(unwrap(client.api.review.threads.$post({ json: { target: targetRef.current, anchor, body } }))),
    [applyMutation],
  )

  const editDraft = useCallback(
    (id: string, body: string) =>
      applyMutation(
        unwrap(client.api.review.messages[':id'].$patch({ param: { id }, json: { target: targetRef.current, body } })),
        MESSAGE_GONE,
      ),
    [applyMutation],
  )

  const deleteDraft = useCallback(
    (id: string) =>
      applyMutation(
        unwrap(client.api.review.messages[':id'].$delete({ param: { id }, json: { target: targetRef.current } })),
        MESSAGE_GONE,
      ),
    [applyMutation],
  )

  return {
    review: state && state.key === key ? state.review : null,
    error: errorState && errorState.key === key ? errorState.message : null,
    reviewer,
    createThread,
    editDraft,
    deleteDraft,
  }
}
