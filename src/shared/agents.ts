import type { AgentId } from "./api.ts"

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
}

export const MODEL_PATTERN = /^[A-Za-z0-9][\w.:\-[\]]*$/

export const EFFORT_PATTERN = /^[a-z][a-z0-9-]*$/
