export type FileStatus = 'A' | 'M' | 'D' | 'R'

export interface FileStatusBadgeProps {
  status: FileStatus
}

const STATUS_LABEL: Record<FileStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
}

const STATUS_CLASS: Record<FileStatus, string> = {
  A: 'ods-badge--A',
  M: '',
  D: 'ods-badge--D',
  R: 'ods-badge--R',
}

export function FileStatusBadge({ status }: FileStatusBadgeProps) {
  return (
    <span className={`ods-badge ${STATUS_CLASS[status]}`} title={STATUS_LABEL[status]}>
      {status}
    </span>
  )
}
