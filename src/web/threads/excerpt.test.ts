import { describe, expect, it } from 'vitest'
import { excerpt } from './excerpt.ts'

describe('excerpt', () => {
  it('takes the first non-empty line', () => {
    expect(excerpt('\n\nfirst line\nsecond')).toBe('first line')
  })

  it('drops inline markdown marks and list or heading prefixes', () => {
    expect(excerpt('## Use `foo` **now**')).toBe('Use foo now')
    expect(excerpt('- item one')).toBe('item one')
  })

  it('is empty for an empty body', () => {
    expect(excerpt('')).toBe('')
  })
})
