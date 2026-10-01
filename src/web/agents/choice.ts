import type { AgentId, AgentModel, AgentStatus } from '../../shared/api.ts'

export type AgentChoice = { agent: AgentId; model: string; effort: string | null }

export type StoredChoice = {
  agent: AgentId
  models: Partial<Record<AgentId, string>>
  efforts: Partial<Record<AgentId, string>>
}

const STORAGE_KEY = 'outil:agent'
const AGENT_ORDER: AgentId[] = ['claude', 'codex']

function isAgentId(value: unknown): value is AgentId {
  return value === 'claude' || value === 'codex'
}

export function parseStoredChoice(value: unknown): StoredChoice | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { agent?: unknown; model?: unknown; models?: unknown; efforts?: unknown }
  if (!isAgentId(raw.agent)) return null
  const models: Partial<Record<AgentId, string>> = {}
  if (typeof raw.models === 'object' && raw.models !== null) {
    for (const [agent, model] of Object.entries(raw.models)) {
      if (isAgentId(agent) && typeof model === 'string') models[agent] = model
    }
  }
  if (typeof raw.model === 'string' && raw.model !== '' && !models[raw.agent]) models[raw.agent] = raw.model
  const efforts: Partial<Record<AgentId, string>> = {}
  if (typeof raw.efforts === 'object' && raw.efforts !== null) {
    for (const [agent, effort] of Object.entries(raw.efforts)) {
      if (isAgentId(agent) && typeof effort === 'string') efforts[agent] = effort
    }
  }
  return { agent: raw.agent, models, efforts }
}

export function loadAgentChoice(): StoredChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseStoredChoice(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveAgentChoice(choice: StoredChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
  } catch {
    return
  }
}

export function resolveAgent(stored: StoredChoice | null, readyAgents: AgentStatus[]): AgentId | null {
  const readyIds = new Set(readyAgents.map((agent) => agent.id))
  if (stored && readyIds.has(stored.agent)) return stored.agent
  return AGENT_ORDER.find((id) => readyIds.has(id)) ?? null
}

function resolveModel(stored: StoredChoice | null, agent: AgentId, models: AgentModel[]): AgentModel | null {
  if (models.length === 0) return null
  const remembered = stored?.models[agent]
  return models.find((model) => model.id === remembered) ?? models[0]
}

export function resolveEffort(stored: StoredChoice | null, agent: AgentId, model: AgentModel | null): string | null {
  if (!model || model.efforts.length === 0) return null
  const remembered = stored?.efforts[agent]
  if (remembered && model.efforts.includes(remembered)) return remembered
  return model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : null
}

export function resolveChoice(
  stored: StoredChoice | null,
  readyAgents: AgentStatus[],
  modelsByAgent: Partial<Record<AgentId, AgentModel[]>>,
): AgentChoice | null {
  const agent = resolveAgent(stored, readyAgents)
  if (!agent) return null
  const model = resolveModel(stored, agent, modelsByAgent[agent] ?? [])
  return model ? { agent, model: model.id, effort: resolveEffort(stored, agent, model) } : null
}
