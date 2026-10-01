import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentModel, AgentStatus } from '../../shared/api.ts'
import { AGENT_NAMES } from '../../shared/agents.ts'
import { Avatar, Button, MenuOption, Note, Popover, Spinner, Tag } from '../design-system'
import { useAgentChoice } from './useAgentChoice.ts'
import './AgentPanel.css'

const STATE_LABEL: Record<AgentStatus['state'], string> = {
  ready: 'Ready',
  'signed-out': 'Not signed in',
  'not-installed': 'Not installed',
}

function renderFix(fix: string): ReactNode {
  return fix.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))
}

function moveBetweenOptions(event: ReactKeyboardEvent<HTMLUListElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  if (options.length === 0) return
  event.preventDefault()
  const step = event.key === 'ArrowDown' ? 1 : -1
  options[(index + step + options.length) % options.length].focus()
}

function CheckAgainButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" className="agent-panel__recheck" onClick={onClick} disabled={loading}>
      {loading && <Spinner />}
      Check again
    </Button>
  )
}

function AgentRow({ status, checked, onSelect }: { status: AgentStatus; checked: boolean; onSelect: () => void }) {
  return (
    <li className="agent-panel__row">
      <MenuOption
        checked={checked}
        disabled={status.state !== 'ready'}
        icon={<span className="ods-dia" aria-hidden="true" />}
        trailing={status.state !== 'ready' ? <Tag>{STATE_LABEL[status.state]}</Tag> : undefined}
        onSelect={onSelect}
      >
        {status.name}
      </MenuOption>
      {status.state !== 'ready' && status.fix && <p className="agent-panel__fix">{renderFix(status.fix)}</p>}
    </li>
  )
}

function ModelRow({ model, checked, onSelect }: { model: AgentModel; checked: boolean; onSelect: () => void }) {
  return (
    <li className="agent-panel__row">
      <MenuOption checked={checked} onSelect={onSelect}>
        {model.label}
      </MenuOption>
    </li>
  )
}

export function AgentPanel() {
  const {
    agents,
    ready,
    agentsLoading,
    agentsError,
    recheckAgents,
    agent,
    model,
    models,
    modelsLoading,
    modelsError,
    selectAgent,
    selectModel,
  } = useAgentChoice()
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
    if (open) {
      close()
      return
    }
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

  if (agentsLoading && agents.length === 0) {
    return (
      <div className="agent-panel agent-panel--loading">
        <Spinner />
        <span>Checking agents…</span>
      </div>
    )
  }

  if (agentsError) {
    return (
      <Note variant="failure" action={<CheckAgainButton loading={agentsLoading} onClick={recheckAgents} />}>
        {agentsError}
      </Note>
    )
  }

  if (!agent) {
    return (
      <Note variant="hint" action={<CheckAgainButton loading={agentsLoading} onClick={recheckAgents} />}>
        <span className="agent-panel__empty">
          No coding agent is ready. Install Claude Code or Codex and sign in, then check again.
          <ul className="agent-panel__list">
            {agents.map((status) => (
              <li key={status.id}>
                {status.name}: {STATE_LABEL[status.state]}
                {status.fix && <span> — {renderFix(status.fix)}</span>}
              </li>
            ))}
          </ul>
        </span>
      </Note>
    )
  }

  const notReady = agents.length - ready.length
  const modelLabel = models.find((candidate) => candidate.id === model)?.label ?? model

  return (
    <div className="agent-panel" ref={wrapperRef}>
      <Avatar kind="agent" />
      <Button
        variant="ghost"
        className="agent-panel__toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <span className="agent-panel__choice">
          <span className="agent-panel__choice-name">{AGENT_NAMES[agent]}</span>
          {modelLabel && <span className="agent-panel__model">{modelLabel}</span>}
        </span>
      </Button>
      {notReady > 0 && <Tag>{notReady} not ready</Tag>}
      {shown &&
        pos &&
        createPortal(
          <div className="agent-panel__popover" style={{ top: pos.top, left: pos.left }}>
            <Popover ariaLabel="Choose the agent and model">
              <div
                ref={focusPopover}
                tabIndex={-1}
                className="agent-panel__popover-body"
              >
                <div className="agent-panel__section">
                  <p className="agent-panel__section-title">Agent</p>
                  <ul className="agent-panel__rows" role="radiogroup" aria-label="Agent" onKeyDown={moveBetweenOptions}>
                    {agents.map((status) => (
                      <AgentRow key={status.id} status={status} checked={status.id === agent} onSelect={() => selectAgent(status.id)} />
                    ))}
                  </ul>
                </div>
                <div className="agent-panel__section">
                  <p className="agent-panel__section-title">Model</p>
                  {modelsLoading && models.length === 0 && (
                    <p className="agent-panel__models-loading">
                      <Spinner /> Loading models…
                    </p>
                  )}
                  {modelsError && <Note variant="failure">{modelsError}</Note>}
                  {models.length > 0 && (
                    <ul className="agent-panel__rows" role="radiogroup" aria-label="Model" onKeyDown={moveBetweenOptions}>
                      {models.map((candidate) => (
                        <ModelRow key={candidate.id} model={candidate} checked={candidate.id === model} onSelect={() => selectModel(candidate.id)} />
                      ))}
                    </ul>
                  )}
                </div>
                <CheckAgainButton loading={agentsLoading} onClick={recheckAgents} />
              </div>
            </Popover>
          </div>,
          document.body,
        )}
    </div>
  )
}
