import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CommitSummary } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'
import { Button, Checkbox, Note, Spinner, TextInput } from '../design-system'
import { relativeTime, shortSha } from '../format.ts'
import { useDebounced } from '../useDebounced.ts'
import { useInView } from '../diff/useInView.ts'
import './HistoryList.css'
import './RailRow.css'

const PAGE_SIZE = 50

type Page = { commits: CommitSummary[]; hasMore: boolean; loading: boolean; error: string | null }

const CommitRow = memo(function CommitRow({
  commit,
  selected,
  picked,
  pickDisabled,
  onSelect,
  onPick,
}: {
  commit: CommitSummary
  selected: boolean
  picked: boolean
  pickDisabled: boolean
  onSelect: (sha: string) => void
  onPick: (commit: CommitSummary, picked: boolean) => void
}) {
  return (
    <li className="history__item">
      <Checkbox
        className="history__pick"
        checked={picked}
        disabled={pickDisabled}
        onChange={(event) => onPick(commit, event.target.checked)}
        label={<span className="visually-hidden">Select {shortSha(commit.sha)} to compare</span>}
      />
      <button
        type="button"
        className="rail-row history__row"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(commit.sha)}
      >
        <span className="history__subject">{commit.subject || 'No commit message'}</span>
        <span className="history__meta">
          <code className="history__sha">{shortSha(commit.sha)}</code>
          <span className="history__author">{commit.author.name}</span>
          <time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>
            {relativeTime(commit.date)}
          </time>
        </span>
      </button>
    </li>
  )
})

function LoadMore({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref, '400px 0px')
  useEffect(() => {
    if (visible) onVisible()
  }, [visible, onVisible])
  return (
    <div ref={ref} className="history__status">
      <Spinner /> Loading more commits…
    </div>
  )
}

type Props = {
  selected: string[]
  onSelect: (sha: string) => void
  onCompare: (base: string, head: string) => void
}

export function HistoryList({ selected, onSelect, onCompare }: Props) {
  const [picked, setPicked] = useState<CommitSummary[]>([])
  const [message, setMessage] = useState('')
  const [author, setAuthor] = useState('')
  const filterKey = useDebounced(`${message.trim()}\u0000${author.trim()}`, 250)
  const [page, setPage] = useState<Page>({ commits: [], hasMore: true, loading: false, error: null })
  const requested = useRef<string | null>(null)

  const loadPage = useCallback(
    (skip: number) => {
      const key = `${filterKey}\u0000${skip}`
      if (requested.current === key) return
      requested.current = key
      setPage((previous) => ({ ...previous, loading: true, error: null }))
      const [message, author] = filterKey.split('\u0000')
      unwrap(client.api.history.$get({ query: { skip: String(skip), limit: String(PAGE_SIZE), message, author } }))
        .then((body) => {
          if (!requested.current?.startsWith(`${filterKey}\u0000`)) return
          setPage((previous) => ({
            commits: skip === 0 ? body.commits : [...previous.commits, ...body.commits],
            hasMore: body.hasMore,
            loading: false,
            error: null,
          }))
        })
        .catch((err: Error) => {
          requested.current = null
          setPage((previous) => ({ ...previous, loading: false, error: err.message }))
        })
    },
    [filterKey],
  )

  useEffect(() => {
    requested.current = null
    loadPage(0)
  }, [loadPage])

  const loadMore = useCallback(() => {
    if (!page.loading && page.hasMore) loadPage(page.commits.length)
  }, [loadPage, page.loading, page.hasMore, page.commits.length])

  const filtered = filterKey !== '\u0000'

  const pick = useCallback((commit: CommitSummary, value: boolean) => {
    setPicked((current) => {
      const others = current.filter((p) => p.sha !== commit.sha)
      return value ? [...others, commit].slice(-2) : others
    })
  }, [])

  const compare = () => {
    const position = (sha: string) => page.commits.findIndex((commit) => commit.sha === sha)
    const [older, newer] = [...picked].sort((a, b) => {
      const [positionA, positionB] = [position(a.sha), position(b.sha)]
      if (positionA >= 0 && positionB >= 0) return positionB - positionA
      return Date.parse(a.date) - Date.parse(b.date)
    })
    setPicked([])
    onCompare(older.sha, newer.sha)
  }

  return (
    <div className="history">
      <div className="history__filters">
        <TextInput
          type="search"
          placeholder="Filter by message"
          aria-label="Filter commits by message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <TextInput
          type="search"
          placeholder="Filter by author"
          aria-label="Filter commits by author"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
      </div>
      {picked.length > 0 && (
        <div className="history__compare">
          <span>{picked.length === 1 ? 'Select one more commit to compare.' : 'Two commits selected.'}</span>
          <span className="history__compare-actions">
            <Button variant="ghost" onClick={() => setPicked([])}>
              Clear
            </Button>
            <Button variant="primary" disabled={picked.length < 2} onClick={compare}>
              Compare
            </Button>
          </span>
        </div>
      )}
      <ol className="history__rows" aria-label="Commits, newest first">
        {page.commits.map((commit) => (
          <CommitRow
            key={commit.sha}
            commit={commit}
            selected={selected.includes(commit.sha)}
            picked={picked.some((p) => p.sha === commit.sha)}
            pickDisabled={picked.length >= 2 && !picked.some((p) => p.sha === commit.sha)}
            onSelect={onSelect}
            onPick={pick}
          />
        ))}
      </ol>
      {page.error && (
        <Note variant="failure" action={<Button onClick={loadMore}>Retry</Button>}>
          {page.error}
        </Note>
      )}
      {!page.error && page.hasMore && <LoadMore key={`${filterKey}:${page.commits.length}`} onVisible={loadMore} />}
      {!page.loading && !page.hasMore && page.commits.length === 0 && (
        <Note variant="hint">{filtered ? 'No commits match these filters.' : 'This repository has no commits yet.'}</Note>
      )}
    </div>
  )
}
