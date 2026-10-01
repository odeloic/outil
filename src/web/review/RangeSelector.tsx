import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CommitSummary, RefEntry, RefList } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'
import { Icon, MenuOption, Spinner } from '../design-system'
import { relativeTime, shortSha } from '../format.ts'
import { navigate } from '../router.ts'
import { moveBetweenOptions } from '../arrowNav.ts'
import { useDismiss } from './useDismiss.ts'
import { refNameFor, useRefs } from './useRefs.ts'
import './RangeSelector.css'

const RECENT_LIMIT = '50'
const MAX_SHOWN_REFS = 100

function RefGroup({ title, entries, sha, onPick }: { title: string; entries: RefEntry[]; sha: string | null; onPick: (sha: string) => void }) {
  if (entries.length === 0) return null
  return (
    <>
      <p className="range-select__group">{title}</p>
      {entries.map((entry) => (
        <MenuOption
          key={entry.name}
          checked={entry.sha === sha}
          trailing={entry.sha === sha ? <Icon name="check" /> : undefined}
          onSelect={() => onPick(entry.sha)}
        >
          <span className="range-select__option">
            <span className="range-select__subject">{entry.name}</span>
            <code className="range-select__sha">{shortSha(entry.sha)}</code>
          </span>
        </MenuOption>
      ))}
    </>
  )
}

function RefSelect({
  label,
  sha,
  refs,
  refsError,
  onPick,
}: {
  label: string
  sha: string | null
  refs: RefList | null
  refsError: string | null
  onPick: (sha: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [commits, setCommits] = useState<CommitSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close, buttonRef)
  const focusMenu = useCallback((element: HTMLDivElement | null) => element?.focus(), [])

  useEffect(() => {
    if (!open || commits) return
    let cancelled = false
    unwrap(client.api.history.$get({ query: { skip: '0', limit: RECENT_LIMIT, message: '', author: '' } }))
      .then((body) => {
        if (cancelled) return
        setCommits(body.commits)
        setError(null)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [open, commits])

  const pick = (next: string) => {
    setOpen(false)
    if (next !== sha) onPick(next)
  }

  return (
    <div className="range-select" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="range-select__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={sha ?? undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="range-select__label">{label}</span>
        <code className="range-select__sha">{sha ? (refNameFor(refs, sha) ?? shortSha(sha)) : 'Root'}</code>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="range-select__menu" ref={focusMenu} tabIndex={-1} role="dialog" aria-label={`${label} commit`} onKeyDown={moveBetweenOptions}>
          {!commits && !error && (
            <p className="range-select__status">
              <Spinner /> Loading…
            </p>
          )}
          {error && <p className="range-select__status">{error}</p>}
          {refsError && <p className="range-select__status">Branches and tags could not be loaded: {refsError}</p>}
          <div role="radiogroup" aria-label="Commit">
          <RefGroup title="Branches" entries={refs?.branches ?? []} sha={sha} onPick={pick} />
          <RefGroup title="Tags" entries={refs?.tags ?? []} sha={sha} onPick={pick} />
          {refs?.truncated && <p className="range-select__note">Showing the {MAX_SHOWN_REFS} most recent branches and tags.</p>}
          {commits && commits.length > 0 && <p className="range-select__group">Recent commits</p>}
          {commits?.map((commit) => (
            <MenuOption
              key={commit.sha}
              checked={commit.sha === sha}
              trailing={commit.sha === sha ? <Icon name="check" /> : undefined}
              onSelect={() => pick(commit.sha)}
            >
              <span className="range-select__option">
                <code className="range-select__sha">{shortSha(commit.sha)}</code>
                <span className="range-select__subject">{commit.subject || 'No commit message'}</span>
                <span className="range-select__when">{relativeTime(commit.date)}</span>
              </span>
            </MenuOption>
          ))}
          </div>
          {commits && commits.length >= Number(RECENT_LIMIT) && <p className="range-select__note">Showing the {RECENT_LIMIT} most recent commits.</p>}
        </div>
      )}
    </div>
  )
}

export function RangeSelector({ base, head, children }: { base: string | null; head: string; children?: ReactNode }) {
  const { refs, error: refsError } = useRefs()
  return (
    <div className="range-selector">
      <RefSelect label="Base" sha={base} refs={refs} refsError={refsError} onPick={(sha) => navigate({ base: sha, head })} />
      <button
        type="button"
        className="range-selector__swap"
        aria-label="Swap base and head"
        disabled={base === null}
        onClick={() => base && navigate({ base: head, head: base })}
      >
        <Icon name="arrow-swap" />
      </button>
      <RefSelect label="Head" sha={head} refs={refs} refsError={refsError} onPick={(sha) => navigate(base ? { base, head: sha } : { ref: sha })} />
      {children}
    </div>
  )
}
