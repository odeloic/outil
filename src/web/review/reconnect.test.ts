import { describe, expect, it } from 'vitest'
import { nextBackoffMs } from './reconnect.ts'

describe('nextBackoffMs', () => {
  it('ramps up 1s, 2s, 5s', () => {
    expect(nextBackoffMs(0)).toBe(1000)
    expect(nextBackoffMs(1)).toBe(2000)
    expect(nextBackoffMs(2)).toBe(5000)
  })

  it('stays at 5s for later attempts', () => {
    expect(nextBackoffMs(3)).toBe(5000)
    expect(nextBackoffMs(10)).toBe(5000)
  })
})
