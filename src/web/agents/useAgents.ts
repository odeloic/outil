import { useSyncExternalStore } from 'react'
import type { AgentStatus } from '../../shared/api.ts'
import { client, unwrap } from '../api.ts'

type State = {
  agents: AgentStatus[]
  loading: boolean
  error: string | null
}

let state: State = { agents: [], loading: true, error: null }
let started = false
const listeners = new Set<() => void>()

function setState(next: State) {
  state = next
  listeners.forEach((listener) => listener())
}

let latestRequest = 0

async function load(refresh: boolean) {
  const request = ++latestRequest
  setState({ ...state, loading: true })
  try {
    const agents = await unwrap(client.api.agents.$get({ query: refresh ? { refresh: '1' } : {} }))
    if (request === latestRequest) setState({ agents, loading: false, error: null })
  } catch (err) {
    if (request === latestRequest) setState({ ...state, loading: false, error: err instanceof Error ? err.message : String(err) })
  }
}

function recheck(): Promise<void> {
  return load(true)
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true
    load(false)
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export type UseAgents = {
  agents: AgentStatus[]
  ready: AgentStatus[]
  loading: boolean
  error: string | null
  recheck: () => Promise<void>
}

export function useAgents(): UseAgents {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  return {
    ...snapshot,
    ready: snapshot.agents.filter((agent) => agent.state === 'ready'),
    recheck,
  }
}
