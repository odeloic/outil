import { useCallback, useState } from 'react'
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
}

export function useAgentChoice(): UseAgentChoice {
  const { agents, ready, loading: agentsLoading, error: agentsError, recheck } = useAgents()
  const [stored, setStored] = useState<StoredChoice | null>(() => loadAgentChoice())
  const agent = resolveAgent(stored, ready)
  const { models, loading: modelsLoading, error: modelsError } = useAgentModels(agent)
  const choice = agent ? resolveChoice(stored, ready, { [agent]: models }) : null

  const selectAgent = useCallback((id: AgentId) => {
    setStored((prev) => {
      const next: StoredChoice = { agent: id, models: prev?.models ?? {} }
      saveAgentChoice(next)
      return next
    })
  }, [])

  const selectModel = useCallback(
    (id: string) => {
      if (!agent) return
      setStored((prev) => {
        const next: StoredChoice = { agent, models: { ...prev?.models, [agent]: id } }
        saveAgentChoice(next)
        return next
      })
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
  }
}
