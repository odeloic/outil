import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChangeSet, ReviewTarget, Run, Thread } from '../../shared/api.ts'
import { draftCount } from '../../shared/review.ts'
import { FileDiffView } from '../diff/FileDiffView.tsx'
import { Button, CountBadge, Note, Tabs } from '../design-system'
import { initials } from '../threads/initials.ts'
import { DisplayOptions } from './DisplayOptions.tsx'
import { FileList } from './FileList.tsx'
import { HistoryList } from './HistoryList.tsx'
import { jumpToFile, resetNavigation, useCurrentFile } from './navigation.ts'
import { useReview } from './useReview.ts'
import { useViewedFiles } from './viewed.ts'
import './Review.css'

type RailTab = 'files' | 'history'

const NO_THREADS: Thread[] = []
const NO_RUNS: Run[] = []

type Props = {
  reviewKey: string
  changes: ChangeSet
  header: ReactNode
  notice?: ReactNode
  pending: boolean
  selectedCommits: string[]
  onSelectCommit: (sha: string) => void
  onCompare: (base: string, head: string) => void
  reviewTarget: ReviewTarget
}

export function Review({
  reviewKey,
  changes,
  header,
  notice,
  pending,
  selectedCommits,
  onSelectCommit,
  onCompare,
  reviewTarget,
}: Props) {
  const [viewed, setViewed] = useViewedFiles(reviewKey)
  const [overrides, setOverrides] = useState<{ key: string; map: ReadonlyMap<string, boolean> }>({
    key: reviewKey,
    map: new Map(),
  })
  if (overrides.key !== reviewKey) setOverrides({ key: reviewKey, map: new Map() })
  const collapsedOverrides = overrides.key === reviewKey ? overrides.map : new Map<string, boolean>()
  const [railTab, setRailTab] = useState<RailTab>('files')
  const current = useCurrentFile(changes.files.length)
  const { review, error, reviewer, createThread, editDraft, deleteDraft } = useReview(reviewTarget)
  const reviewerInitials = useMemo(() => initials(reviewer), [reviewer])
  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>()
    for (const thread of review?.threads ?? []) {
      const list = map.get(thread.anchor.path)
      if (list) list.push(thread)
      else map.set(thread.anchor.path, [thread])
    }
    return map
  }, [review])
  const drafts = review ? draftCount(review) : 0
  const runs = review?.runs ?? NO_RUNS

  useEffect(() => resetNavigation, [reviewKey])

  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setOverrides(({ key, map }) => ({ key, map: new Map(map).set(path, collapsed) }))
  }, [])

  const markViewed = useCallback(
    (path: string, value: boolean) => {
      setViewed(path, value)
      setOverrides(({ key, map }) => {
        const next = new Map(map)
        next.delete(path)
        return { key, map: next }
      })
    },
    [setViewed],
  )

  const setAllCollapsed = (collapsed: boolean) => {
    setOverrides({ key: reviewKey, map: new Map(changes.files.map((file) => [file.path, collapsed])) })
  }

  return (
    <>
      {header}
      <div className="review">
        <aside className="review__rail">
          <div className="review__summary">
            <div className="review__summary-header">
              <span className="review__summary-title">Review</span>
              <CountBadge count={drafts} />
            </div>
            <p className="review__summary-text">{drafts === 0 ? 'No drafts' : `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} not sent`}</p>
            {error && <Note variant="failure">{error}</Note>}
          </div>
          <Tabs<RailTab>
            tabs={[
              { key: 'files', label: 'Files', count: changes.files.length },
              { key: 'history', label: 'History' },
            ]}
            active={railTab}
            onChange={setRailTab}
          />
          <div className="review__panel" role="tabpanel" aria-label="Files" hidden={railTab !== 'files'}>
            <FileList changes={changes} current={current} viewed={viewed} threadsByPath={threadsByPath} onSelect={jumpToFile} />
          </div>
          <div className="review__panel" role="tabpanel" aria-label="History" hidden={railTab !== 'history'}>
            <HistoryList selected={selectedCommits} onSelect={onSelectCommit} onCompare={onCompare} />
          </div>
        </aside>
        <main className="review__main" aria-busy={pending}>
          <div className="review__toolbar">
            <DisplayOptions />
            <span className="review__toolbar-actions">
              <Button variant="ghost" onClick={() => setAllCollapsed(true)}>
                Collapse all
              </Button>
              <Button variant="ghost" onClick={() => setAllCollapsed(false)}>
                Expand all
              </Button>
            </span>
          </div>
          {notice}
          {changes.files.length === 0 && <Note variant="hint">There are no changes to show.</Note>}
          {changes.files.map((file, index) => {
            const fileThreads = threadsByPath.get(file.path) ?? NO_THREADS
            return (
              <FileDiffView
                key={`${reviewKey}:${file.path}`}
                index={index}
                range={changes}
                file={file}
                collapsed={collapsedOverrides.get(file.path) ?? viewed.has(file.path)}
                viewed={viewed.has(file.path)}
                onCollapse={setCollapsed}
                onViewed={markViewed}
                threads={fileThreads}
                runs={fileThreads.length > 0 ? runs : NO_RUNS}
                reviewerInitials={reviewerInitials}
                onCreateThread={createThread}
                onEditDraft={editDraft}
                onDeleteDraft={deleteDraft}
              />
            )
          })}
        </main>
      </div>
    </>
  )
}
