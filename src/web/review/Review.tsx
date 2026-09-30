import { useCallback, useState, type ReactNode } from 'react'
import type { ChangeSet } from '../../shared/api.ts'
import { FileDiffView } from '../diff/FileDiffView.tsx'
import { Button } from '../design-system'
import { DisplayOptions } from './DisplayOptions.tsx'
import { FileList } from './FileList.tsx'
import { jumpToFile, useCurrentFile } from './navigation.ts'
import { useViewedFiles } from './viewed.ts'
import './Review.css'

type Props = {
  reviewKey: string
  changes: ChangeSet
  header: ReactNode
  notice?: ReactNode
}

export function Review({ reviewKey, changes, header, notice }: Props) {
  const [viewed, setViewed] = useViewedFiles(reviewKey)
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const current = useCurrentFile(changes.files.length)

  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setOverrides((previous) => new Map(previous).set(path, collapsed))
  }, [])

  const markViewed = useCallback(
    (path: string, value: boolean) => {
      setViewed(path, value)
      setOverrides((previous) => {
        const next = new Map(previous)
        next.delete(path)
        return next
      })
    },
    [setViewed],
  )

  const setAllCollapsed = (collapsed: boolean) => {
    setOverrides(new Map(changes.files.map((file) => [file.path, collapsed])))
  }

  return (
    <>
      {header}
      <div className="review">
        <aside className="review__rail">
          <FileList changes={changes} current={current} viewed={viewed} onSelect={jumpToFile} />
        </aside>
        <main className="review__main">
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
              key={file.path}
              index={index}
              range={changes}
              file={file}
              collapsed={overrides.get(file.path) ?? viewed.has(file.path)}
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
