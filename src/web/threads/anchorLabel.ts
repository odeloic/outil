import type { ThreadAnchor } from '../../shared/api.ts'

export function anchorLabel(anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'>): string {
  const range = anchor.startLine === anchor.endLine ? `Line ${anchor.startLine}` : `Lines ${anchor.startLine}–${anchor.endLine}`
  return anchor.side === 'old' ? `${range} (old)` : range
}

export function anchorRange(anchor: Pick<ThreadAnchor, 'side' | 'startLine' | 'endLine'>): string {
  const range = anchor.startLine === anchor.endLine ? `L${anchor.startLine}` : `L${anchor.startLine}–${anchor.endLine}`
  return anchor.side === 'old' ? `${range} old` : range
}

export function anchorLocation(anchor: Pick<ThreadAnchor, 'path' | 'startLine' | 'endLine'>): string {
  const name = anchor.path.slice(anchor.path.lastIndexOf('/') + 1)
  return anchor.startLine === anchor.endLine ? `${name}:${anchor.startLine}` : `${name}:${anchor.startLine}-${anchor.endLine}`
}
