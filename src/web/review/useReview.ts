import { useCallback, useEffect, useRef, useState } from 'react'
import type { Review, ReviewTarget, ThreadAnchor } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'

export function targetKey(target: ReviewTarget): string {
  return target.kind === 'commit' ? target.sha : `${target.base}..${target.head}`
}

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
  const [state, setState] = useState<{ key: string; review: Review } | null>(null)
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null)
  const [reviewer, setReviewer] = useState<string | null>(null)
  const targetRef = useRef(target)
  const seqRef = useRef(0)

  useEffect(() => {
    targetRef.current = target
  })

  useEffect(() => {
    const seq = ++seqRef.current
    const current = targetRef.current
    const query = current.kind === 'commit' ? { commit: current.sha } : { base: current.base, head: current.head }
    unwrap(client.api.review.$get({ query }))
      .then((body) => {
        if (seqRef.current !== seq) return
        setState({ key, review: body })
        setErrorState(null)
      })
      .catch((err: Error) => {
        if (seqRef.current !== seq) return
        setErrorState({ key, message: err.message })
      })
  }, [key])

  useEffect(() => {
    let cancelled = false
    unwrap(client.api.repo.$get())
      .then((info) => !cancelled && setReviewer(info.reviewer))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const applyMutation = useCallback((promise: Promise<Review>) => {
    const seq = ++seqRef.current
    return promise.then((next) => {
      if (seqRef.current === seq) {
        setState({ key: targetKey(targetRef.current), review: next })
        setErrorState(null)
      }
      return next
    })
  }, [])

  const createThread = useCallback(
    (anchor: ThreadAnchor, body: string) =>
      applyMutation(unwrap(client.api.review.threads.$post({ json: { target: targetRef.current, anchor, body } }))),
    [applyMutation],
  )

  const editDraft = useCallback(
    (id: string, body: string) =>
      applyMutation(unwrap(client.api.review.messages[':id'].$patch({ param: { id }, json: { target: targetRef.current, body } }))),
    [applyMutation],
  )

  const deleteDraft = useCallback(
    (id: string) => applyMutation(unwrap(client.api.review.messages[':id'].$delete({ param: { id }, json: { target: targetRef.current } }))),
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
