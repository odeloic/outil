import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../shared/api.ts'
import { clearRunActivity, getRunActivity, recordActivity } from './runActivity.ts'

let counter = 0
function uniqueRunId(): string {
  counter += 1
  return `run-${counter}`
}

function line(runId: string, seq: number, text: string): ActivityEvent {
  return { runId, seq, text, at: `t${seq}` }
}

describe('recordActivity', () => {
  it('appends in-order lines for a run', () => {
    const runId = uniqueRunId()
    recordActivity(line(runId, 1, 'a'))
    recordActivity(line(runId, 2, 'b'))

    expect(getRunActivity(runId).map((e) => e.text)).toEqual(['a', 'b'])
  })

  it('ignores a replayed line whose seq is at or below the last one recorded for that run', () => {
    const runId = uniqueRunId()
    recordActivity(line(runId, 1, 'a'))
    recordActivity(line(runId, 2, 'b'))
    recordActivity(line(runId, 1, 'a-replayed'))
    recordActivity(line(runId, 2, 'b-replayed'))

    expect(getRunActivity(runId).map((e) => e.text)).toEqual(['a', 'b'])
  })

  it('tracks dedupe per run independently', () => {
    const r1 = uniqueRunId()
    const r2 = uniqueRunId()
    recordActivity(line(r1, 1, 'r1-a'))
    recordActivity(line(r2, 1, 'r2-a'))
    recordActivity(line(r1, 1, 'r1-replayed'))

    expect(getRunActivity(r1).map((e) => e.text)).toEqual(['r1-a'])
    expect(getRunActivity(r2).map((e) => e.text)).toEqual(['r2-a'])
  })

  it('accepts a later line again after clearRunActivity resets the dedupe state', () => {
    const runId = uniqueRunId()
    recordActivity(line(runId, 1, 'a'))
    clearRunActivity(runId)
    recordActivity(line(runId, 1, 'a-again'))

    expect(getRunActivity(runId).map((e) => e.text)).toEqual(['a-again'])
  })
})
