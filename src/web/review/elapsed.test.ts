import { describe, expect, it } from 'vitest'
import { formatElapsed } from './elapsed.ts'

describe('formatElapsed', () => {
  it('formats sub-minute durations as 0:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(5000)).toBe('0:05')
    expect(formatElapsed(59_000)).toBe('0:59')
  })

  it('formats minutes and pads seconds', () => {
    expect(formatElapsed(60_000)).toBe('1:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(10 * 60_000 + 3_000)).toBe('10:03')
  })

  it('floors partial seconds', () => {
    expect(formatElapsed(1999)).toBe('0:01')
  })

  it('never goes negative', () => {
    expect(formatElapsed(-500)).toBe('0:00')
  })
})
