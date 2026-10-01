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
  effort: string | null
  efforts: string[]
  defaultEffort: string | null
  models: AgentModel[]
  modelsLoading: boolean
  modelsError: string | null
  selectAgent: (agent: AgentId) => void
  selectModel: (model: string) => void
  selectEffort: (effort: string) => void
  clearEffort: () => void
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

  const chosenModel = models.find((candidate) => candidate.id === choice?.model)

  const selectAgent = useCallback((id: AgentId) => {
    setStored({ agent: id, models: stored?.models ?? {}, efforts: stored?.efforts ?? {} })
  }, [])

  const selectModel = useCallback(
    (id: string) => {
      if (!agent) return
      setStored({ agent, models: { ...stored?.models, [agent]: id }, efforts: stored?.efforts ?? {} })
    },
    [agent],
  )

  const selectEffort = useCallback(
    (id: string) => {
      if (!agent) return
      setStored({ agent, models: stored?.models ?? {}, efforts: { ...stored?.efforts, [agent]: id } })
    },
    [agent],
  )

  const clearEffort = useCallback(() => {
    if (!agent || !stored) return
    const efforts = { ...stored.efforts }
    delete efforts[agent]
    setStored({ agent, models: stored.models, efforts })
  }, [agent])

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
    effort: choice?.effort ?? null,
    efforts: chosenModel?.efforts ?? [],
    defaultEffort: chosenModel?.defaultEffort ?? null,
    models,
    modelsLoading,
    modelsError,
    selectAgent,
    selectModel,
    selectEffort,
    clearEffort,
    stored: current,
  }
}
