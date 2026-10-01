import { Icon } from '../media/Icon.tsx'
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
      {status === 'answered' && <Icon name="comment-discussion" className="ods-chip__icon" />}
      {status === 'failed' && <Icon name="warning" className="ods-chip__icon" />}
      {status === 'draft' && 'Draft'}
      {status === 'sent' && 'Waiting'}
      {status === 'answered' && (unread ? 'New reply' : 'Answered')}
      {status === 'answered' && unread && <span className="ods-chip__dot" aria-hidden="true" />}
      {status === 'resolved' && <Icon name="check" className="ods-chip__icon" />}
      {status === 'resolved' && 'Resolved'}
      {status === 'failed' && 'No reply'}
    </span>
  )
}
