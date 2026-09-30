import { describe, expect, it } from 'vitest'
import type { Review } from '../../shared/api.ts'
import { pickReview, targetKey } from './useReview.ts'

function review(revision: number, generation = 'g1'): Review {
  const sha = 'a'.repeat(40)
  return { key: sha, target: { kind: 'commit', sha }, base: null, head: sha, threads: [], runs: [], nextThread: 1, revision, generation }
}

describe('targetKey', () => {
  it('keys a commit target by its sha', () => {
    expect(targetKey({ kind: 'commit', sha: 'abc' })).toBe('abc')
  })

  it('keys a compare target by base..head', () => {
    expect(targetKey({ kind: 'compare', base: 'a', head: 'b' })).toBe('a..b')
  })
})

describe('pickReview', () => {
  it('adopts a response when there is nothing yet', () => {
    const next = pickReview(null, 'k', review(0))
    expect(next).toEqual({ key: 'k', review: review(0) })
  })

  it('keeps the higher-revision response for the same key, regardless of arrival order', () => {
    const higher = { key: 'k', review: review(3) }
    expect(pickReview(higher, 'k', review(1))).toBe(higher)
  })

  it('adopts a response with a higher revision than the one currently held', () => {
    const lower = { key: 'k', review: review(1) }
    const result = pickReview(lower, 'k', review(2))
    expect(result).toEqual({ key: 'k', review: review(2) })
  })

  it('adopts a same-revision response as a no-op replacement', () => {
    const current = { key: 'k', review: review(2) }
    const result = pickReview(current, 'k', review(2))
    expect(result).toBe(current)
  })

  it('always adopts a response for a different key', () => {
    const current = { key: 'k1', review: review(9) }
    const result = pickReview(current, 'k2', review(0))
    expect(result).toEqual({ key: 'k2', review: review(0) })
  })

  it('adopts a response with a lower revision when the generation differs', () => {
    const current = { key: 'k', review: review(9, 'g1') }
    const reset = review(0, 'g2')
    const result = pickReview(current, 'k', reset)
    expect(result).toEqual({ key: 'k', review: reset })
  })
})
