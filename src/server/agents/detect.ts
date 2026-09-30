import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, AgentStatus } from "../../shared/api.ts";

const exec = promisify(execFile);

type AgentDef = {
  id: AgentId;
  name: string;
  bin: string;
  install: string;
  login: string;
  signedIn: (env: NodeJS.ProcessEnv) => Promise<boolean>;
};

const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
    install: "Install it with `npm install -g @anthropic-ai/claude-code`.",
    login: "Run `claude auth login`.",
    signedIn: async (env) => {
      const { stdout } = await exec("claude", ["auth", "status"], { env, timeout: 10_000 });
      return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
    },
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    install: "Install it with `npm install -g @openai/codex`.",
    login: "Run `codex login`.",
    signedIn: async (env) => {
      await exec("codex", ["login", "status"], { env, timeout: 10_000 });
      return true;
    },
  },
];

async function findExecutable(bin: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const dirs = (env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  for (const dir of dirs) {
    const candidate = join(dir, bin);
    try {
      await access(candidate, fsConstants.X_OK);
      if ((await stat(candidate)).isFile()) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function detectOne(agent: AgentDef, env: NodeJS.ProcessEnv): Promise<AgentStatus> {
  if (!(await findExecutable(agent.bin, env))) {
    return { id: agent.id, name: agent.name, state: "not-installed", fix: agent.install };
  }
  const ready = await agent.signedIn(env).catch(() => false);
  return ready
    ? { id: agent.id, name: agent.name, state: "ready", fix: null }
    : { id: agent.id, name: agent.name, state: "signed-out", fix: agent.login };
}

export function detectAgents(env: NodeJS.ProcessEnv = process.env): Promise<AgentStatus[]> {
  return Promise.all(AGENTS.map((agent) => detectOne(agent, env)));
}
