import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEvent, AgentId, Review, ReviewTarget, ThreadAnchor } from '../../shared/api.ts'
import { ApiRequestError, client, unwrap } from '../api.ts'
import { nextBackoffMs } from './reconnect.ts'
import { clearRunActivity, recordActivity } from './runActivity.ts'

export function targetKey(target: ReviewTarget): string {
  return target.kind === 'commit' ? target.sha : `${target.base}..${target.head}`
}

type KeyedReview = { key: string; review: Review }

export function pickReview(prev: KeyedReview | null, key: string, review: Review): KeyedReview {
  if (prev && prev.key === key && prev.review.generation === review.generation && prev.review.revision >= review.revision) return prev
  return { key, review }
}

const MESSAGE_GONE = 'This comment no longer exists.'
const DISCONNECTED_MESSAGE = 'Lost connection to the review. Reconnecting…'

export type UseReview = {
  review: Review | null
  error: string | null
  reviewer: string | null
  createThread: (anchor: ThreadAnchor, body: string) => Promise<Review>
  editDraft: (id: string, body: string) => Promise<Review>
  deleteDraft: (id: string) => Promise<Review>
  addFollowUp: (threadId: string, body: string) => Promise<Review>
  resolveThread: (threadId: string, resolved: boolean) => Promise<Review>
  send: (agent: AgentId, model: string, effort: string | null, threadIds?: string[]) => Promise<Review>
  cancel: (runId: string) => Promise<Review>
  markRead: (threadId: string) => Promise<Review>
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
    const dispatchKey = key
    const current = targetRef.current
    const query: Record<string, string> =
      current.kind === 'commit' ? { commit: current.sha } : { base: current.base, head: current.head }
    const url = `/api/review/events?${new URLSearchParams(query)}`

    let source: EventSource | null = null
    let backoffTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let stopped = false

    const onReview = (event: MessageEvent<string>) => {
      let review: Review
      try {
        review = JSON.parse(event.data) as Review
      } catch {
        return
      }
      applyResponse(dispatchKey, review)
      for (const run of review.runs) {
        if (run.state !== 'running' && run.state !== 'queued') clearRunActivity(run.id)
      }
    }

    const onActivity = (event: MessageEvent<string>) => {
      try {
        recordActivity(JSON.parse(event.data) as ActivityEvent)
      } catch {
        return
      }
    }

    const open = () => {
      const es = new EventSource(url)
      source = es
      es.addEventListener('review', onReview)
      es.addEventListener('activity', onActivity)
      es.onopen = () => {
        attempt = 0
      }
      es.onerror = () => {
        if (stopped || es.readyState !== EventSource.CLOSED) return
        setErrorState({ key: dispatchKey, message: DISCONNECTED_MESSAGE })
        void fetchReview(dispatchKey)
        es.removeEventListener('review', onReview)
        es.removeEventListener('activity', onActivity)
        const wait = nextBackoffMs(attempt)
        attempt += 1
        backoffTimer = setTimeout(() => {
          if (!stopped) open()
        }, wait)
      }
    }

    open()

    return () => {
      stopped = true
      if (backoffTimer) clearTimeout(backoffTimer)
      source?.removeEventListener('review', onReview)
      source?.removeEventListener('activity', onActivity)
      source?.close()
    }
  }, [key, applyResponse, fetchReview])

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

  const addFollowUp = useCallback(
    (threadId: string, body: string) =>
      applyMutation(
        unwrap(client.api.review.threads[':id'].messages.$post({ param: { id: threadId }, json: { target: targetRef.current, body } })),
      ),
    [applyMutation],
  )

  const resolveThread = useCallback(
    (threadId: string, resolved: boolean) =>
      applyMutation(
        unwrap(client.api.review.threads[':id'].resolve.$post({ param: { id: threadId }, json: { target: targetRef.current, resolved } })),
      ),
    [applyMutation],
  )

  const send = useCallback(
    (agent: AgentId, model: string, effort: string | null, threadIds?: string[]) =>
      applyMutation(unwrap(client.api.review.send.$post({ json: { target: targetRef.current, agent, model, effort, ...(threadIds ? { threadIds } : {}) } }))),
    [applyMutation],
  )

  const cancel = useCallback(
    (runId: string) =>
      applyMutation(unwrap(client.api.review.runs[':id'].cancel.$post({ param: { id: runId }, json: { target: targetRef.current } }))),
    [applyMutation],
  )

  const markRead = useCallback(
    (threadId: string) =>
      applyMutation(
        unwrap(client.api.review.threads[':id'].read.$post({ param: { id: threadId }, json: { target: targetRef.current } })),
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
    addFollowUp,
    resolveThread,
    send,
    cancel,
    markRead,
  }
}
