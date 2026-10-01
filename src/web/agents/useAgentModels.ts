import { useCallback, useSyncExternalStore } from 'react'
import type { AgentId, AgentModel } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'

type ModelsState = { models: AgentModel[]; loading: boolean; error: string | null }

const NULL_STATE: ModelsState = { models: [], loading: false, error: null }
const LOADING_STATE: ModelsState = { models: [], loading: true, error: null }

const cache = new Map<AgentId, ModelsState>()
const listeners = new Map<AgentId, Set<() => void>>()
const started = new Set<AgentId>()

function notify(agent: AgentId) {
  listeners.get(agent)?.forEach((listener) => listener())
}

function setState(agent: AgentId, state: ModelsState) {
  cache.set(agent, state)
  notify(agent)
}

function load(agent: AgentId) {
  setState(agent, LOADING_STATE)
  unwrap(client.api.agents[':id'].models.$get({ param: { id: agent } })).then(
    (models) => setState(agent, { models, loading: false, error: null }),
    (err: unknown) => setState(agent, { models: [], loading: false, error: err instanceof Error ? err.message : String(err) }),
  )
}

function subscribeTo(agent: AgentId, listener: () => void) {
  let set = listeners.get(agent)
  if (!set) {
    set = new Set()
    listeners.set(agent, set)
  }
  set.add(listener)
  if (!started.has(agent)) {
    started.add(agent)
    load(agent)
  }
  return () => set!.delete(listener)
}

export function reloadAgentModels() {
  for (const agent of started) load(agent)
}

export function useAgentModels(agent: AgentId | null): ModelsState {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!agent) return () => {}
      return subscribeTo(agent, listener)
    },
    [agent],
  )
  const getSnapshot = useCallback(() => {
    if (!agent) return NULL_STATE
    return cache.get(agent) ?? LOADING_STATE
  }, [agent])
  return useSyncExternalStore(subscribe, getSnapshot)
}
