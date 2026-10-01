import { describe, expect, it } from 'vitest'
import type { AgentId, AgentModel, AgentStatus } from '../../shared/api.ts'
import { parseStoredChoice, resolveChoice, resolveEffort } from './choice.ts'

const status = (id: AgentId, state: AgentStatus['state'] = 'ready'): AgentStatus => ({
  id,
  name: id === 'claude' ? 'Claude Code' : 'Codex',
  state,
  fix: state === 'ready' ? null : 'fix it',
})

const model = (id: string, efforts: string[] = [], defaultEffort: string | null = null): AgentModel => ({ id, label: id, efforts, defaultEffort })

describe('resolveChoice', () => {
  it('returns null when no agent is ready', () => {
    expect(resolveChoice(null, [], {})).toBeNull()
  })

  it('picks claude before codex when nothing is stored', () => {
    const readyAgents = [status('codex'), status('claude')]
    const modelsByAgent = { claude: [model('opus')], codex: [model('gpt-6.1-sol')] }
    expect(resolveChoice(null, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'opus', effort: null })
  })

  it('keeps the stored agent when it is ready', () => {
    const readyAgents = [status('claude'), status('codex')]
    const modelsByAgent = { claude: [model('opus')], codex: [model('gpt-6.1-sol')] }
    expect(resolveChoice({ agent: 'codex', models: { codex: 'gpt-6.1-sol' }, efforts: {} }, readyAgents, modelsByAgent)).toEqual({
      agent: 'codex',
      model: 'gpt-6.1-sol',
      effort: null,
    })
  })

  it('falls back to the first ready agent when the stored one is not ready', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus')] }
    expect(resolveChoice({ agent: 'codex', models: { codex: 'gpt-6.1-sol' }, efforts: {} }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'opus',
      effort: null,
    })
  })

  it('selects the only ready agent with no prompt', () => {
    const readyAgents = [status('codex')]
    const modelsByAgent = { codex: [model('gpt-6.1-sol'), model('gpt-6-luna')] }
    expect(resolveChoice(null, readyAgents, modelsByAgent)).toEqual({ agent: 'codex', model: 'gpt-6.1-sol', effort: null })
  })

  it('keeps the stored model when it is in the agent model list', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus'), model('sonnet'), model('haiku')] }
    expect(resolveChoice({ agent: 'claude', models: { claude: 'sonnet' }, efforts: {} }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'sonnet',
      effort: null,
    })
  })

  it('falls back to the first model when the stored model is not in the list', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus'), model('sonnet')] }
    expect(resolveChoice({ agent: 'claude', models: { claude: 'gone' }, efforts: {} }, readyAgents, modelsByAgent)).toEqual({
      agent: 'claude',
      model: 'opus',
      effort: null,
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
    const stored = { agent: 'claude' as const, models: { claude: 'opus', codex: 'gpt-6.1-sol' }, efforts: {} }
    expect(resolveChoice(stored, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'opus', effort: null })
  })

  it('reads the older single-model shape', () => {
    expect(parseStoredChoice({ agent: 'codex', model: 'gpt-6-luna' })).toEqual({ agent: 'codex', models: { codex: 'gpt-6-luna' }, efforts: {} })
  })

  it('ignores unknown agents and malformed values', () => {
    expect(parseStoredChoice({ agent: 'gemini', model: 'x' })).toBeNull()
    expect(parseStoredChoice({ agent: 'claude', models: { gemini: 'x', codex: 3 }, efforts: {} })).toEqual({ agent: 'claude', models: {}, efforts: {} })
  })
})

describe('effort', () => {
  const levels = ['low', 'medium', 'high']

  it('uses the remembered effort when the model offers it', () => {
    const stored = { agent: 'codex' as const, models: {}, efforts: { codex: 'high' } }
    expect(resolveEffort(stored, 'codex', model('gpt-6-luna', levels, 'medium'))).toBe('high')
  })

  it('sends no effort when the remembered one is not offered, even if the model has a default', () => {
    const stored = { agent: 'codex' as const, models: {}, efforts: { codex: 'ultra' } }
    expect(resolveEffort(stored, 'codex', model('gpt-5.5', levels, 'medium'))).toBeNull()
  })

  it('sends no effort when nothing is stored, even if the model has a default', () => {
    expect(resolveEffort(null, 'codex', model('gpt-6-luna', levels, 'medium'))).toBeNull()
    const readyAgents = [status('codex')]
    const modelsByAgent = { codex: [model('gpt-6-luna', levels, 'medium')] }
    expect(resolveChoice(null, readyAgents, modelsByAgent)).toEqual({ agent: 'codex', model: 'gpt-6-luna', effort: null })
  })

  it('has no effort when the model offers none or none is remembered', () => {
    const stored = { agent: 'claude' as const, models: {}, efforts: { claude: 'high' } }
    expect(resolveEffort(stored, 'claude', model('haiku'))).toBeNull()
    expect(resolveEffort(null, 'claude', model('opus', levels))).toBeNull()
    expect(resolveEffort(stored, 'claude', null)).toBeNull()
  })

  it('resolves the effort together with the choice and survives a model switch', () => {
    const readyAgents = [status('claude')]
    const modelsByAgent = { claude: [model('opus', levels), model('haiku')] }
    const withOpus = { agent: 'claude' as const, models: { claude: 'opus' }, efforts: { claude: 'low' } }
    const withHaiku = { ...withOpus, models: { claude: 'haiku' } }
    expect(resolveChoice(withOpus, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'opus', effort: 'low' })
    expect(resolveChoice(withHaiku, readyAgents, modelsByAgent)).toEqual({ agent: 'claude', model: 'haiku', effort: null })
  })

  it('reads and drops malformed stored efforts', () => {
    expect(parseStoredChoice({ agent: 'claude', efforts: { claude: 'max', codex: 3, gemini: 'low' } })).toEqual({
      agent: 'claude',
      models: {},
      efforts: { claude: 'max' },
    })
  })
})
