import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'

export const client = hc<AppType>('/')

type Body<R> = R extends { json(): Promise<infer B> } ? B : never

export async function unwrap<R extends { json(): Promise<unknown> }>(
  response: Promise<R>,
): Promise<Exclude<Body<R>, { error: string }>> {
  const body = (await (await response).json()) as Body<R>
  if (typeof body === 'object' && body !== null && 'error' in body) throw new Error(String(body.error))
  return body as Exclude<Body<R>, { error: string }>
}
