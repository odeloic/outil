import { useCallback, useSyncExternalStore } from 'react'
import type { AgentId, AgentModel, AgentStatus } from '../../shared/api.ts'
import { loadAgentChoice, resolveAgent, resolveChoice, saveAgentChoice, type StoredChoice } from './choice.ts'
import { reloadAgentModels, useAgentModels } from './useAgentModels.ts'
import { useAgents } from './useAgents.ts'

export type UseAgentChoice = {
  agents: AgentStatus[]
  ready: AgentStatus[]
  agentsLoading: boolean
  agentsError: string | null
  recheckAgents: () => void
  agent: AgentId | null
  model: string | null
  models: AgentModel[]
  modelsLoading: boolean
  modelsError: string | null
  selectAgent: (agent: AgentId) => void
  selectModel: (model: string) => void
  stored: StoredChoice | null
}

let stored: StoredChoice | null = loadAgentChoice()
const listeners = new Set<() => void>()

function getStored(): StoredChoice | null {
  return stored
}

function setStored(next: StoredChoice) {
  stored = next
  saveAgentChoice(next)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAgentChoice(): UseAgentChoice {
  const { agents, ready, loading: agentsLoading, error: agentsError, recheck } = useAgents()
  const current = useSyncExternalStore(subscribe, getStored)
  const agent = resolveAgent(current, ready)
  const { models, loading: modelsLoading, error: modelsError } = useAgentModels(agent)
  const choice = agent ? resolveChoice(current, ready, { [agent]: models }) : null

  const selectAgent = useCallback((id: AgentId) => {
    setStored({ agent: id, models: stored?.models ?? {} })
  }, [])

  const selectModel = useCallback(
    (id: string) => {
      if (!agent) return
      setStored({ agent, models: { ...stored?.models, [agent]: id } })
    },
    [agent],
  )

  const recheckAgents = useCallback(() => {
    void recheck().then(reloadAgentModels)
  }, [recheck])

  return {
    agents,
    ready,
    agentsLoading,
    agentsError,
    recheckAgents,
    agent,
    model: choice?.model ?? null,
    models,
    modelsLoading,
    modelsError,
    selectAgent,
    selectModel,
    stored: current,
  }
}
