import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStatus } from '../../shared/api.ts'
import { Avatar, Button, Note, Popover, Spinner, Tag } from '../design-system'
import { useAgents } from './useAgents.ts'
import './AgentPanel.css'

const STATE_LABEL: Record<AgentStatus['state'], string> = {
  ready: 'Ready',
  'signed-out': 'Not signed in',
  'not-installed': 'Not installed',
}

function renderFix(fix: string): ReactNode {
  return fix.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))
}

function AgentRow({ agent }: { agent: AgentStatus }) {
  return (
    <li className={`agent-panel__row${agent.state === 'ready' ? '' : ' agent-panel__row--unavailable'}`}>
      <span className="agent-panel__row-head">
        <span className="ods-dia" aria-hidden="true" />
        <span className="agent-panel__row-name">{agent.name}</span>
        <Tag>{STATE_LABEL[agent.state]}</Tag>
      </span>
      {agent.state !== 'ready' && agent.fix && <p className="agent-panel__fix">{renderFix(agent.fix)}</p>}
    </li>
  )
}

function CheckAgainButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" className="agent-panel__recheck" onClick={onClick} disabled={loading}>
      {loading && <Spinner />}
      Check again
    </Button>
  )
}

export function AgentPanel() {
  const { agents, ready, loading, error, recheck } = useAgents()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const shown = open && ready.length > 0

  const focusPopover = useCallback((element: HTMLDivElement | null) => {
    popoverRef.current = element
    element?.focus()
  }, [])

  const position = useCallback(() => {
    const toggle = wrapperRef.current?.querySelector<HTMLButtonElement>('.agent-panel__toggle')
    if (!toggle) return
    const rect = toggle.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(toggle).getPropertyValue('--ods-space-2')) || 0
    setPos({ top: rect.bottom + gap, left: rect.left })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setPos(null)
    wrapperRef.current?.querySelector<HTMLButtonElement>('.agent-panel__toggle')?.focus()
  }, [])

  const toggle = () => {
    if (open) return close()
    position()
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!shown) return
    const updatePosition = position
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [shown, close, position])

  if (loading && agents.length === 0) {
    return (
      <div className="agent-panel agent-panel--loading">
        <Spinner />
        <span>Checking agents…</span>
      </div>
    )
  }

  if (error) {
    return (
      <Note variant="failure" action={<CheckAgainButton loading={loading} onClick={recheck} />}>
        {error}
      </Note>
    )
  }

  if (ready.length === 0) {
    return (
      <Note variant="hint" action={<CheckAgainButton loading={loading} onClick={recheck} />}>
        <span className="agent-panel__empty">
          No coding agent is ready. Install Claude Code or Codex and sign in, then check again.
          <ul className="agent-panel__list">
            {agents.map((agent) => (
              <li key={agent.id}>
                {agent.name}: {STATE_LABEL[agent.state]}
                {agent.fix && <span> — {renderFix(agent.fix)}</span>}
              </li>
            ))}
          </ul>
        </span>
      </Note>
    )
  }

  return (
    <div className="agent-panel" ref={wrapperRef}>
      <Avatar kind="agent" />
      <span className="agent-panel__names">{ready.map((agent) => agent.name).join(', ')}</span>
      {agents.length > ready.length && <Tag>{agents.length - ready.length} not ready</Tag>}
      <Button
        variant="ghost"
        className="agent-panel__toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        Agents
      </Button>
      {shown &&
        pos &&
        createPortal(
          <div className="agent-panel__popover" style={{ top: pos.top, left: pos.left }}>
            <Popover ariaLabel="Agent availability">
              <div
                ref={focusPopover}
                tabIndex={-1}
                className="agent-panel__popover-body"
              >
                <ul className="agent-panel__rows">
                  {agents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} />
                  ))}
                </ul>
                <CheckAgainButton loading={loading} onClick={recheck} />
              </div>
            </Popover>
          </div>,
          document.body,
        )}
    </div>
  )
}
