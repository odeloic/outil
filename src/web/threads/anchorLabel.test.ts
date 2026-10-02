import { describe, expect, it } from 'vitest'
import { anchorLocation } from './anchorLabel.ts'

describe('anchorLocation', () => {
  it('uses the file basename and a single line', () => {
    expect(anchorLocation({ path: 'src/web/Review.tsx', startLine: 12, endLine: 12 })).toBe('Review.tsx:12')
  })

  it('uses a start-end range for multiple lines', () => {
    expect(anchorLocation({ path: 'src/a.ts', startLine: 3, endLine: 9 })).toBe('a.ts:3-9')
  })

  it('handles a path without a directory', () => {
    expect(anchorLocation({ path: 'README.md', startLine: 1, endLine: 1 })).toBe('README.md:1')
  })
})
