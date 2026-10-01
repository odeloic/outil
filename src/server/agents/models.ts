import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, AgentModel } from "../../shared/api.ts";
import { EFFORT_PATTERN } from "../../shared/agents.ts";

const exec = promisify(execFile);

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const CLAUDE_MODELS: AgentModel[] = [
  { id: "fable", label: "Fable", efforts: CLAUDE_EFFORTS, defaultEffort: null },
  { id: "opus", label: "Opus", efforts: CLAUDE_EFFORTS, defaultEffort: null },
  { id: "sonnet", label: "Sonnet", efforts: CLAUDE_EFFORTS, defaultEffort: null },
  { id: "haiku", label: "Haiku", efforts: [], defaultEffort: null },
];

type CodexModel = {
  slug: string;
  display_name: string;
  visibility: string;
  priority: number;
  default_reasoning_level?: string;
  supported_reasoning_levels?: { effort?: unknown }[];
};

async function codexModels(env: NodeJS.ProcessEnv): Promise<AgentModel[]> {
  const { stdout } = await exec("codex", ["debug", "models"], { env, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  const { models } = JSON.parse(stdout) as { models?: CodexModel[] };
  return (models ?? [])
    .filter((model) => model.visibility === "list")
    .sort((a, b) => a.priority - b.priority)
    .map((model) => {
      const efforts = (model.supported_reasoning_levels ?? [])
        .map((level) => level?.effort)
        .filter((effort): effort is string => typeof effort === "string" && EFFORT_PATTERN.test(effort));
      const defaultLevel = model.default_reasoning_level;
      return {
        id: model.slug,
        label: model.display_name,
        efforts,
        defaultEffort: defaultLevel !== undefined && efforts.includes(defaultLevel) ? defaultLevel : null,
      };
    });
}

export async function listModels(agent: AgentId, env: NodeJS.ProcessEnv = process.env): Promise<AgentModel[]> {
  switch (agent) {
    case "claude":
      return CLAUDE_MODELS;
    case "codex":
      return codexModels(env);
    default:
      throw new Error(`"${String(agent)}" is not a supported agent.`);
  }
}
