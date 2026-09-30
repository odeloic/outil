import type { ChangeSet, FileChange, FileChangeStatus } from '../../shared/api.ts'
import { DiffStat, FileStatusBadge, Tag, type FileStatus } from '../design-system'
import './FileList.css'

const BADGE: Record<FileChangeStatus, FileStatus> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }

function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/')
  return (
    <span className="file-list__path">
      {slash >= 0 && <span className="file-list__dir">{path.slice(0, slash + 1)}</span>}
      {path.slice(slash + 1)}
    </span>
  )
}

function FileRow({ file }: { file: FileChange }) {
  return (
    <li className="file-list__row">
      <FileStatusBadge status={BADGE[file.status]} />
      <span className="file-list__name" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
        {file.oldPath && (
          <>
            <FilePath path={file.oldPath} />
            <span className="file-list__arrow" aria-hidden="true">→</span>
            <span className="visually-hidden">renamed to</span>
          </>
        )}
        <FilePath path={file.path} />
      </span>
      {file.binary ? <Tag>Binary</Tag> : <DiffStat added={file.additions} removed={file.deletions} />}
    </li>
  )
}

export function FileList({ changes }: { changes: ChangeSet }) {
  const count = changes.files.length
  return (
    <nav className="file-list" aria-label="Changed files">
      <div className="file-list__summary">
        <span>
          {count} {count === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStat added={changes.additions} removed={changes.deletions} />
      </div>
      <ul className="file-list__rows">
        {changes.files.map((file) => (
          <FileRow key={file.path} file={file} />
        ))}
      </ul>
    </nav>
  )
}
