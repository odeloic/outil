import type { ThreadAnchor } from '../../shared/api.ts'

export function anchorLabel(anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'>): string {
  const range = anchor.startLine === anchor.endLine ? `Line ${anchor.startLine}` : `Lines ${anchor.startLine}–${anchor.endLine}`
  return anchor.side === 'old' ? `${range} (old)` : range
}
