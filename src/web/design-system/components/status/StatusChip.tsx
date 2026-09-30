import { Spinner } from '../feedback/Spinner.tsx'

export type ThreadStatus = 'draft' | 'sent' | 'answered' | 'resolved' | 'failed'

export interface StatusChipProps {
  status: ThreadStatus
  unread?: boolean
}

const STATUS_CLASS: Record<ThreadStatus, string> = {
  draft: 'ods-chip--draft',
  sent: 'ods-chip--sent',
  answered: 'ods-chip--answered',
  resolved: 'ods-chip--resolved',
  failed: 'ods-chip--failed',
}

export function StatusChip({ status, unread = false }: StatusChipProps) {
  return (
    <span className={`ods-chip ${STATUS_CLASS[status]}`}>
      {status === 'sent' && <Spinner className="ods-chip__icon" />}
      {status === 'answered' && <span className="ods-dia ods-chip__icon" aria-hidden="true" />}
      {status === 'draft' && 'Draft'}
      {status === 'sent' && 'Waiting'}
      {status === 'answered' && (unread ? 'New reply' : 'Answered')}
      {status === 'resolved' && '✓ Resolved'}
      {status === 'failed' && '! No reply'}
    </span>
  )
}
