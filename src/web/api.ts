import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'
import type { ApiError } from '../shared/api.ts'

export const client = hc<AppType>('/')

export async function unwrap<T extends object>(response: Promise<{ json(): Promise<T | ApiError> }>): Promise<T> {
  const body = await (await response).json()
  if ('error' in body) throw new Error(body.error)
  return body as T
}
