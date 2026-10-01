import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '../../shared/api.ts'
import { followNotReadyWatch } from './sendError.ts'

const codex = (state: AgentStatus['state']): AgentStatus => ({
  id: 'codex',
  name: 'Codex',
  state,
  fix: state === 'ready' ? null : 'Run `codex login`.',
})

describe('followNotReadyWatch', () => {
  it('keeps the error while the client still believes the agent is ready', () => {
    const watch = { agent: 'codex' as const, sawNotReady: false }
    expect(followNotReadyWatch(watch, [codex('ready')])).toEqual({ watch, clear: false })
  })

  it('notes when the agent is seen as not ready, then clears once it is ready again', () => {
    const first = followNotReadyWatch({ agent: 'codex', sawNotReady: false }, [codex('signed-out')])
    expect(first).toEqual({ watch: { agent: 'codex', sawNotReady: true }, clear: false })
    expect(followNotReadyWatch(first.watch, [codex('ready')])).toEqual({ watch: null, clear: true })
  })

  it('returns the same watch when nothing changed, so render-time updates settle', () => {
    const watch = { agent: 'codex' as const, sawNotReady: true }
    expect(followNotReadyWatch(watch, [codex('signed-out')]).watch).toBe(watch)
    expect(followNotReadyWatch(null, [codex('ready')])).toEqual({ watch: null, clear: false })
  })
})
