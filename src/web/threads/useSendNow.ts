import { createContext, useContext } from 'react'
import type { Review } from '../../shared/api.ts'

export type SendNowValue = {
  reason: string | null
  errors: Readonly<Record<string, string>>
  sendNow: (threadId: string) => void
}

export const SendNowContext = createContext<SendNowValue>({ reason: 'Sending is unavailable.', errors: {}, sendNow: () => {} })

export function useSendNow(): SendNowValue {
  return useContext(SendNowContext)
}

export function newThreadId(review: Review): string | null {
  return review.threads.at(-1)?.id ?? null
}
