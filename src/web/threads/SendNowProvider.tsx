import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { AgentId, Review } from '../../shared/api.ts'
import { useAgentChoice } from '../agents/useAgentChoice.ts'
import { SendNowContext } from './useSendNow.ts'

type Props = {
  send: (agent: AgentId, model: string, effort: string | null, threadIds: string[]) => Promise<Review>
  children: ReactNode
}

export function SendNowProvider({ send, children }: Props) {
  const { agent, model, effort, modelsLoading, modelsError } = useAgentChoice()
  const [errors, setErrors] = useState<Record<string, string>>({})

  const reason = !agent
    ? 'No agent is ready — open the agent menu.'
    : modelsLoading
      ? 'Loading models…'
      : modelsError
        ? modelsError
        : model === null
          ? 'No model is available.'
          : null

  const sendNow = useCallback(
    (threadId: string) => {
      if (!agent || !model) return
      setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== threadId)))
      send(agent, model, effort, [threadId]).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        setErrors((prev) => ({ ...prev, [threadId]: message }))
      })
    },
    [agent, model, effort, send],
  )

  const value = useMemo(() => ({ reason, errors, sendNow }), [reason, errors, sendNow])
  return <SendNowContext.Provider value={value}>{children}</SendNowContext.Provider>
}
