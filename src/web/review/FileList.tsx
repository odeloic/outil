import { memo, useEffect, useRef } from 'react'
import type { ChangeSet, FileChange } from '../../shared/api.ts'
import { DiffStat, FileStatusBadge, ProgressBar, Tag } from '../design-system'
import { FILE_STATUS_BADGE } from '../fileStatus.ts'
import { revealInScrollParent } from './navigation.ts'
import './FileList.css'

function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/')
  return (
    <span className="file-list__path">
      {slash >= 0 && <span className="file-list__dir">{path.slice(0, slash + 1)}</span>}
      {path.slice(slash + 1)}
    </span>
  )
}

const FileRow = memo(function FileRow({
  file,
  index,
  current,
  viewed,
  onSelect,
}: {
  file: FileChange
  index: number
  current: boolean
  viewed: boolean
  onSelect: (index: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (current && ref.current) revealInScrollParent(ref.current)
  }, [current])

  return (
    <li>
      <button
        ref={ref}
        type="button"
        className={`file-list__row${viewed ? ' file-list__row--viewed' : ''}`}
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(index)}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <FileStatusBadge status={FILE_STATUS_BADGE[file.status]} />
        <span className="file-list__name">
          {file.oldPath && (
            <>
              <FilePath path={file.oldPath} />
              <span className="file-list__arrow" aria-hidden="true">→</span>
              <span className="visually-hidden">renamed to</span>
            </>
          )}
          <FilePath path={file.path} />
        </span>
        {viewed && (
          <span className="file-list__viewed">
            <span aria-hidden="true">✓</span>
            <span className="visually-hidden">viewed</span>
          </span>
        )}
        {file.binary ? <Tag>Binary</Tag> : <DiffStat added={file.additions} removed={file.deletions} />}
      </button>
    </li>
  )
})

type Props = {
  changes: ChangeSet
  current: number
  viewed: ReadonlySet<string>
  onSelect: (index: number) => void
}

export function FileList({ changes, current, viewed, onSelect }: Props) {
  const count = changes.files.length
  const viewedCount = changes.files.filter((file) => viewed.has(file.path)).length
  return (
    <nav className="file-list" aria-label="Changed files">
      <div className="file-list__summary">
        <span>
          {count} {count === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStat added={changes.additions} removed={changes.deletions} />
      </div>
      <div className="file-list__progress">
        <ProgressBar value={viewedCount} max={Math.max(count, 1)} label={`${viewedCount} of ${count} files viewed`} />
      </div>
      <ul className="file-list__rows">
        {changes.files.map((file, index) => (
          <FileRow
            key={file.path}
            file={file}
            index={index}
            current={index === current}
            viewed={viewed.has(file.path)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  )
}
