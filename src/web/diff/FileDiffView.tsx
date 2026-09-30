import { memo, useEffect, useRef, useState } from 'react'
import type { FileChange, FileDiff } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'
import { Button, DiffStat, FileStatusBadge, Spinner, Tag } from '../design-system'
import { FILE_STATUS_BADGE } from '../fileStatus.ts'
import { BodyNote } from './BodyNote.tsx'
import { TextDiff } from './TextDiff.tsx'
import { useInView } from './useInView.ts'
import './FileDiff.css'
import './syntax.css'

type Range = { base: string | null; head: string }

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function FileBody({ range, file }: { range: Range; file: FileChange }) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (file.binary) return
    let cancelled = false
    const query = {
      head: range.head,
      path: file.path,
      ...(range.base ? { base: range.base } : {}),
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      ...(full ? { full: '1' } : {}),
    }
    unwrap(client.api['file-diff'].$get({ query }))
      .then((body) => !cancelled && setDiff(body))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [range.base, range.head, file.path, file.oldPath, file.binary, full])

  if (file.binary || diff?.kind === 'binary') return <BodyNote>Binary file, not shown.</BodyNote>
  if (error) return <BodyNote variant="failure">{error}</BodyNote>
  if (!diff) {
    return (
      <p className="file-diff__loading">
        <Spinner /> Loading diff…
      </p>
    )
  }
  if (diff.kind === 'too-large') {
    return (
      <BodyNote
        action={
          <Button
            onClick={() => {
              setDiff(null)
              setFull(true)
            }}
          >
            Load diff
          </Button>
        }
      >
        This file is {formatBytes(diff.bytes)} and is not loaded automatically.
      </BodyNote>
    )
  }
  return <TextDiff path={file.path} diff={diff} />
}

export const FileDiffView = memo(function FileDiffView({ range, file }: { range: Range; file: FileChange }) {
  const ref = useRef<HTMLElement>(null)
  const visible = useInView(ref, '1200px 0px')
  const estimatedLines = Math.min(file.additions + file.deletions + 6, 60)

  return (
    <section ref={ref} className="file-diff" aria-label={file.path}>
      <header className="file-diff__header">
        <FileStatusBadge status={FILE_STATUS_BADGE[file.status]} />
        <span className="file-diff__path">
          {file.oldPath && (
            <>
              {file.oldPath} <span aria-hidden="true">→</span>
              <span className="visually-hidden">renamed to</span>{' '}
            </>
          )}
          {file.path}
        </span>
        {file.binary ? <Tag>Binary</Tag> : <DiffStat added={file.additions} removed={file.deletions} />}
      </header>
      <div className="file-diff__body" style={visible ? undefined : { minHeight: `calc(${estimatedLines} * var(--diff-line-height))` }}>
        {visible && <FileBody range={range} file={file} />}
      </div>
    </section>
  )
})
