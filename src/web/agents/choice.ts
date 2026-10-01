import type { AgentId, AgentModel, AgentStatus } from '../../shared/api.ts'

export type AgentChoice = { agent: AgentId; model: string }

export type StoredChoice = { agent: AgentId; models: Partial<Record<AgentId, string>> }

const STORAGE_KEY = 'outil:agent'
const AGENT_ORDER: AgentId[] = ['claude', 'codex']

function isAgentId(value: unknown): value is AgentId {
  return value === 'claude' || value === 'codex'
}

export function parseStoredChoice(value: unknown): StoredChoice | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { agent?: unknown; model?: unknown; models?: unknown }
  if (!isAgentId(raw.agent)) return null
  const models: Partial<Record<AgentId, string>> = {}
  if (typeof raw.models === 'object' && raw.models !== null) {
    for (const [agent, model] of Object.entries(raw.models)) {
      if (isAgentId(agent) && typeof model === 'string') models[agent] = model
    }
  }
  if (typeof raw.model === 'string' && raw.model !== '' && !models[raw.agent]) models[raw.agent] = raw.model
  return { agent: raw.agent, models }
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

function resolveModel(stored: StoredChoice | null, agent: AgentId, models: AgentModel[]): string | null {
  if (models.length === 0) return null
  const remembered = stored?.models[agent]
  if (remembered && models.some((model) => model.id === remembered)) return remembered
  return models[0].id
}

export function resolveChoice(
  stored: StoredChoice | null,
  readyAgents: AgentStatus[],
  modelsByAgent: Partial<Record<AgentId, AgentModel[]>>,
): AgentChoice | null {
  const agent = resolveAgent(stored, readyAgents)
  if (!agent) return null
  const model = resolveModel(stored, agent, modelsByAgent[agent] ?? [])
  return model ? { agent, model } : null
}
