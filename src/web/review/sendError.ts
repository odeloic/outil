import type { AgentId, AgentStatus } from '../../shared/api.ts'

export type NotReadyWatch = { agent: AgentId; sawNotReady: boolean }

export function followNotReadyWatch(
  watch: NotReadyWatch | null,
  agents: readonly AgentStatus[],
): { watch: NotReadyWatch | null; clear: boolean } {
  if (!watch) return { watch, clear: false }
  const status = agents.find((candidate) => candidate.id === watch.agent)
  if (!status) return { watch, clear: false }
  if (status.state !== 'ready') return { watch: watch.sawNotReady ? watch : { ...watch, sawNotReady: true }, clear: false }
  return watch.sawNotReady ? { watch: null, clear: true } : { watch, clear: false }
}
