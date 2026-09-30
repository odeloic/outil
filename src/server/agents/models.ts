import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, AgentModel } from "../../shared/api.ts";

const exec = promisify(execFile);

const CLAUDE_MODELS: AgentModel[] = [
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

type CodexModel = { slug: string; display_name: string; visibility: string; priority: number };

async function codexModels(env: NodeJS.ProcessEnv): Promise<AgentModel[]> {
  const { stdout } = await exec("codex", ["debug", "models"], { env, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  const { models } = JSON.parse(stdout) as { models?: CodexModel[] };
  return (models ?? [])
    .filter((model) => model.visibility === "list")
    .sort((a, b) => a.priority - b.priority)
    .map((model) => ({ id: model.slug, label: model.display_name }));
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
