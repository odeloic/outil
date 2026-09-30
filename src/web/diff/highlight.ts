export type Token = [className: string, text: string]

export type HighlightRequest = { id: number; path: string; texts: (string | null)[] }
export type HighlightResponse = { id: number; lines: (Token[][] | null)[] }

export const MAX_HIGHLIGHT_CHARS = 400_000

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (lines: HighlightResponse['lines']) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      pending.get(event.data.id)?.(event.data.lines)
      pending.delete(event.data.id)
    }
    worker.onerror = () => {
      pending.forEach((resolve) => resolve([]))
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

export function highlight(path: string, texts: (string | null)[]): Promise<HighlightResponse['lines']> {
  const bounded = texts.map((text) => (text !== null && text.length <= MAX_HIGHLIGHT_CHARS ? text : null))
  if (bounded.every((text) => text === null)) return Promise.resolve(texts.map(() => null))
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ id, path, texts: bounded } satisfies HighlightRequest)
  })
}
