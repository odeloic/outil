import { describe, expect, it } from 'vitest'
import type { RefList } from '../../shared/api.ts'
import { refNameFor } from './useRefs.ts'

const refs: RefList = {
  current: 'main',
  branches: [
    { name: 'feature', sha: 'aaa' },
    { name: 'main', sha: 'aaa' },
    { name: 'other', sha: 'bbb' },
  ],
  tags: [{ name: 'v1', sha: 'ccc' }],
  truncated: false,
}

describe('refNameFor', () => {
  it('prefers the current branch over other branches at the same commit', () => {
    expect(refNameFor(refs, 'aaa')).toBe('main')
  })

  it('falls back to another branch, then to a tag', () => {
    expect(refNameFor(refs, 'bbb')).toBe('other')
    expect(refNameFor(refs, 'ccc')).toBe('v1')
  })

  it('is null when nothing points at the commit or refs are not loaded', () => {
    expect(refNameFor(refs, 'zzz')).toBeNull()
    expect(refNameFor(null, 'aaa')).toBeNull()
  })
})
