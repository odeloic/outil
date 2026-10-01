import type { ReactNode } from 'react'
import { useRepoName } from './useRepoName.ts'
import './TopBar.css'

export function TopBar({ children }: { children?: ReactNode }) {
  const { name: repo, error } = useRepoName()
  return (
    <header className="topbar">
      <nav className="topbar__crumbs" aria-label="Repository">
        <span className="topbar__brand">outil</span>
        {error && (
          <>
            <span className="topbar__sep" aria-hidden="true">
              /
            </span>
            <span className="topbar__repo" title={error}>
              repository unavailable
            </span>
          </>
        )}
        {repo && (
          <>
            <span className="topbar__sep" aria-hidden="true">/</span>
            <span className="topbar__repo">{repo}</span>
          </>
        )}
      </nav>
      <div className="topbar__actions">{children}</div>
    </header>
  )
}
