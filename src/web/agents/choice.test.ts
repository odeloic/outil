import { describe, expect, it } from 'vitest'
import type { AgentId, AgentModel, AgentStatus } from '../../shared/api.ts'
import { parseStoredChoice, resolveChoice } from './choice.ts'

const status = (id: AgentId, state: AgentStatus['state'] = 'ready'): AgentStatus => ({
  id,
  name: id === 'claude' ? 'Claude Code' : 'Codex',
  state,
  fix: state === 'ready' ? null : 'fix it',
})

const model = (id: string): AgentModel => ({ id, label: id })

describe('resolveChoice', () => {
  it('returns null when no agent is ready', () => {
    expect(resolveChoice(null, [], {})).toBeNull()
  })

  it('picks claude before codex when nothing is stored', () => {
    const readyAgents = [status('codex'), status('claude')]
    const modelsByAgent = { claude: [model('opus')], codex: [model('gpt-6.1-sol')] }
    expect(resolveChoice(null, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'opus' })
  })

  it('keeps the stored agent when it is ready', () => {
    const readyAgents = [status('claude'), status('codex')]
    const modelsByAgent = { claude: [model('opus')], codex: [model('gpt-6.1-sol')] }
    expect(resolveChoice({ agent: 'codex', models: { codex: 'gpt-6.1-sol' } }, readyAgents, modelsByAgent)).toEqual({
      agent: 'codex',
      model: 'gpt-6.1-sol',
    })
  })

  it('falls back to the first ready agent when the stored one is not ready', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus')] }
    expect(resolveChoice({ agent: 'codex', models: { codex: 'gpt-6.1-sol' } }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'opus',
    })
  })

  it('selects the only ready agent with no prompt', () => {
    const readyAgents = [status('codex')]
    const modelsByAgent = { codex: [model('gpt-6.1-sol'), model('gpt-6-luna')] }
    expect(resolveChoice(null, readyAgents, modelsByAgent)).toEqual({ agent: 'codex', model: 'gpt-6.1-sol' })
  })

  it('keeps the stored model when it is in the agent model list', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus'), model('sonnet'), model('haiku')] }
    expect(resolveChoice({ agent: 'claude', models: { claude: 'sonnet' } }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'sonnet',
    })
  })

  it('falls back to the first model when the stored model is not in the list', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus'), model('sonnet')] }
    expect(resolveChoice({ agent: 'claude', models: { claude: 'gone' } }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'opus',
    })
  })

  it('returns null while the chosen agent has no models yet', () => {
    const readyAgents = [status('claude')]
    expect(resolveChoice(null, readyAgents, {})).toBeNull()
  })
})

describe('remembering a model per agent', () => {
  it('returns to the model last chosen for an agent after switching away and back', () => {
    const readyAgents = [status('claude'), status('codex')]
    const modelsByAgent = { claude: [model('fable'), model('opus')], codex: [model('gpt-6.1-sol')] }
    const stored = { agent: 'claude' as const, models: { claude: 'opus', codex: 'gpt-6.1-sol' } }
    expect(resolveChoice(stored, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'opus' })
  })

  it('reads the older single-model shape', () => {
    expect(parseStoredChoice({ agent: 'codex', model: 'gpt-6-luna' })).toEqual({ agent: 'codex', models: { codex: 'gpt-6-luna' } })
  })

  it('ignores unknown agents and malformed values', () => {
    expect(parseStoredChoice({ agent: 'gemini', model: 'x' })).toBeNull()
    expect(parseStoredChoice({ agent: 'claude', models: { gemini: 'x', codex: 3 } })).toEqual({ agent: 'claude', models: {} })
  })
})
