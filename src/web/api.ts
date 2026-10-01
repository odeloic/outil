import { hc } from 'hono/client'
import type { AppType } from '../server/routes.ts'

export const client = hc<AppType>('/')

type Body<R> = R extends { json(): Promise<infer B> } ? B : never

export class ApiRequestError extends Error {
  readonly status: number
  readonly fix: string | null

  constructor(status: number, message: string, fix: string | null = null) {
    super(message)
    this.status = status
    this.fix = fix
  }
}

export async function unwrap<R extends { json(): Promise<unknown>; status: number }>(
  response: Promise<R>,
): Promise<Exclude<Body<R>, { error: string }>> {
  const res = await response
  const body = (await res.json()) as Body<R>
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const fix = 'fix' in body && typeof body.fix === 'string' ? body.fix : null
    throw new ApiRequestError(res.status, String(body.error), fix)
  }
  return body as Exclude<Body<R>, { error: string }>
}
