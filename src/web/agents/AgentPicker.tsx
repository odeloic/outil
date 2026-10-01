import { useCallback } from 'react'
import type { AgentModel, AgentStatus } from '../../shared/api.ts'
import { AgentLogo, Button, Icon, Note, SegmentedControl, Spinner, Tag } from '../design-system'
import { moveBetweenOptions } from '../arrowNav.ts'
import { renderFix } from './fixText.tsx'
import { useAgentChoice } from './useAgentChoice.ts'
import './AgentPicker.css'

const STATE_LABEL: Record<AgentStatus['state'], string> = {
  ready: 'Ready',
  'signed-out': 'Not signed in',
  'not-installed': 'Not installed',
}

function CheckAgain({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" className="agent-picker__recheck" onClick={onClick} disabled={loading}>
      {loading && <Spinner />}
      Check again
    </Button>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: string | null; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="agent-picker__section">
      <div className="agent-picker__section-head">
        <h3 className="agent-picker__label">
          {title}
          {hint && <span className="agent-picker__label-hint"> · {hint}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function AgentRow({ status, checked, onSelect }: { status: AgentStatus; checked: boolean; onSelect: () => void }) {
  const ready = status.state === 'ready'
  return (
    <li className="agent-picker__item">
      <button type="button" role="radio" aria-checked={checked} disabled={!ready} className="agent-picker__row agent-picker__row--agent" onClick={onSelect}>
        <AgentLogo agent={status.id} label={status.name} size="xs" />
        <span className="agent-picker__row-name">{status.name}</span>
        {!ready && <Tag>{STATE_LABEL[status.state]}</Tag>}
        {checked && <Icon name="check" className="agent-picker__check" />}
      </button>
      {!ready && status.fix && <p className="agent-picker__fix">{renderFix(status.fix)}</p>}
    </li>
  )
}

function ModelRow({ model, checked, onSelect }: { model: AgentModel; checked: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={checked} className="agent-picker__row agent-picker__row--model" onClick={onSelect}>
        <span className="agent-picker__row-name">{model.label}</span>
        {checked && <Icon name="check" className="agent-picker__check" />}
      </button>
    </li>
  )
}

export function AgentPicker({ id }: { id: string }) {
  const {
    agents,
    ready,
    agentsLoading,
    agentsError,
    recheckAgents,
    agent,
    model,
    effort,
    efforts,
    defaultEffort,
    models,
    modelsLoading,
    modelsError,
    selectAgent,
    selectModel,
    selectEffort,
    clearEffort,
    stored,
  } = useAgentChoice()

  const focusBody = useCallback((element: HTMLDivElement | null) => element?.focus(), [])
  const notReady = agents.length - ready.length
  const storedEffort = agent ? stored?.efforts[agent] : undefined
  const canUseDefault = storedEffort !== undefined && efforts.includes(storedEffort) && storedEffort !== defaultEffort

  let body: React.ReactNode
  if (agentsLoading && agents.length === 0) {
    body = (
      <p className="agent-picker__status">
        <Spinner /> Checking agents…
      </p>
    )
  } else if (agentsError) {
    body = (
      <Note variant="failure" action={<CheckAgain loading={agentsLoading} onClick={recheckAgents} />}>
        {agentsError}
      </Note>
    )
  } else if (!agent) {
    body = (
      <Note variant="hint" action={<CheckAgain loading={agentsLoading} onClick={recheckAgents} />}>
        <span className="agent-picker__empty">
          No coding agent is ready. Install Claude Code or Codex and sign in, then check again.
          <ul className="agent-picker__list">
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
  } else {
    body = (
      <>
        <Section title="Agent">
          <ul className="agent-picker__rows" role="radiogroup" aria-label="Agent" onKeyDown={moveBetweenOptions}>
            {agents.map((status) => (
              <AgentRow key={status.id} status={status} checked={status.id === agent} onSelect={() => selectAgent(status.id)} />
            ))}
          </ul>
        </Section>
        <Section title="Model">
          {modelsLoading && models.length === 0 && (
            <p className="agent-picker__status">
              <Spinner /> Loading models…
            </p>
          )}
          {modelsError && <Note variant="failure">{modelsError}</Note>}
          {models.length > 0 && (
            <ul className="agent-picker__rows" role="radiogroup" aria-label="Model" onKeyDown={moveBetweenOptions}>
              {models.map((candidate) => (
                <ModelRow key={candidate.id} model={candidate} checked={candidate.id === model} onSelect={() => selectModel(candidate.id)} />
              ))}
            </ul>
          )}
          {agent === 'codex' && models.length > 0 && (
            <p className="agent-picker__hint">Codex lists models from your Codex config; a model from a custom provider may not run.</p>
          )}
        </Section>
        {efforts.length > 0 && (
          <Section
            title="Effort"
            hint={defaultEffort ? `default ${defaultEffort}` : null}
            action={
              canUseDefault && (
                <Button variant="ghost" className="agent-picker__use-default" onClick={clearEffort}>
                  Use default
                </Button>
              )
            }
          >
            <div className="agent-picker__effort">
              <SegmentedControl
                ariaLabel="Effort"
                value={effort ?? ''}
                onChange={selectEffort}
                options={efforts.map((level) => ({ value: level, label: level }))}
              />
            </div>
          </Section>
        )}
        {notReady > 0 && <p className="agent-picker__hint">{notReady} not ready</p>}
        <CheckAgain loading={agentsLoading} onClick={recheckAgents} />
      </>
    )
  }

  return (
    <div id={id} ref={focusBody} tabIndex={-1} className="agent-picker" role="dialog" aria-label="Choose the agent, model and effort">
      {body}
    </div>
  )
}
