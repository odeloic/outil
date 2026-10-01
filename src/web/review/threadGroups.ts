import type { Thread } from '../../shared/api.ts'
import { orderThreads } from './navigation.ts'

export type ThreadFilter = 'open' | 'all'

export type ThreadGroups = { groups: [string, Thread[]][]; resolved: Thread[] }

export function unresolvedCount(threads: readonly Thread[]): number {
  return threads.filter((thread) => !thread.resolved).length
}

export function groupThreads(filePaths: readonly string[], threads: readonly Thread[], filter: ThreadFilter): ThreadGroups {
  const ordered = orderThreads(filePaths, threads)
  const shown = filter === 'all' ? ordered : ordered.filter((thread) => !thread.resolved)
  const byFile = new Map<string, Thread[]>()
  for (const thread of shown) {
    const list = byFile.get(thread.anchor.path)
    if (list) list.push(thread)
    else byFile.set(thread.anchor.path, [thread])
  }
  return { groups: [...byFile], resolved: filter === 'all' ? [] : ordered.filter((thread) => thread.resolved) }
}
