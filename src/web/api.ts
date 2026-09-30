import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'

export const client = hc<AppType>('/')

type Body<R> = R extends { json(): Promise<infer B> } ? B : never

export class ApiRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function unwrap<R extends { json(): Promise<unknown>; status: number }>(
  response: Promise<R>,
): Promise<Exclude<Body<R>, { error: string }>> {
  const res = await response
  const body = (await res.json()) as Body<R>
  if (typeof body === 'object' && body !== null && 'error' in body) throw new ApiRequestError(res.status, String(body.error))
  return body as Exclude<Body<R>, { error: string }>
}
