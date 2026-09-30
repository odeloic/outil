import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ChangeSet } from '../../shared/api.ts'
import { FileDiffView } from '../diff/FileDiffView.tsx'
import { Button, Tabs } from '../design-system'
import { DisplayOptions } from './DisplayOptions.tsx'
import { FileList } from './FileList.tsx'
import { HistoryList } from './HistoryList.tsx'
import { jumpToFile, resetNavigation, useCurrentFile } from './navigation.ts'
import { useViewedFiles } from './viewed.ts'
import './Review.css'

type RailTab = 'files' | 'history'

type Props = {
  reviewKey: string
  changes: ChangeSet
  header: ReactNode
  notice?: ReactNode
  pending: boolean
  selectedCommit: string
  onSelectCommit: (sha: string) => void
}

export function Review({ reviewKey, changes, header, notice, pending, selectedCommit, onSelectCommit }: Props) {
  const [viewed, setViewed] = useViewedFiles(reviewKey)
  const [overrides, setOverrides] = useState<{ key: string; map: ReadonlyMap<string, boolean> }>({
    key: reviewKey,
    map: new Map(),
  })
  if (overrides.key !== reviewKey) setOverrides({ key: reviewKey, map: new Map() })
  const collapsedOverrides = overrides.key === reviewKey ? overrides.map : new Map<string, boolean>()
  const [railTab, setRailTab] = useState<RailTab>('files')
  const current = useCurrentFile(changes.files.length)

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
          <Tabs<RailTab>
            tabs={[
              { key: 'files', label: 'Files', count: changes.files.length },
              { key: 'history', label: 'History' },
            ]}
            active={railTab}
            onChange={setRailTab}
          />
          <div className="review__panel" hidden={railTab !== 'files'}>
            <FileList changes={changes} current={current} viewed={viewed} onSelect={jumpToFile} />
          </div>
          <div className="review__panel" hidden={railTab !== 'history'}>
            <HistoryList selected={selectedCommit} onSelect={onSelectCommit} />
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
          {changes.files.map((file, index) => (
            <FileDiffView
              key={`${reviewKey}:${file.path}`}
              index={index}
              range={changes}
              file={file}
              collapsed={collapsedOverrides.get(file.path) ?? viewed.has(file.path)}
              viewed={viewed.has(file.path)}
              onCollapse={setCollapsed}
              onViewed={markViewed}
            />
          ))}
        </main>
      </div>
    </>
  )
}
