import type { FileChangeStatus } from '../shared/api.ts'
import type { FileStatus } from './design-system'

export const FILE_STATUS_BADGE: Record<FileChangeStatus, FileStatus> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }
