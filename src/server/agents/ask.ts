import type { AgentId } from "../../shared/api.ts";
import { parseAnswer, type ParsedAnswer } from "./answer.ts";
import { runAgent } from "./run.ts";
import { withSnapshot } from "./snapshot.ts";

export type AskAgentOptions = {
  repoRoot: string;
  sha: string;
  agent: AgentId;
  model: string;
  effort?: string | null;
  prompt: string;
  threadIds: string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onActivity?: (text: string) => void;
};

export function askAgent(options: AskAgentOptions): Promise<ParsedAnswer> {
  return withSnapshot(options.repoRoot, options.sha, async (cwd) => {
    const raw = await runAgent({
      agent: options.agent,
      model: options.model,
      effort: options.effort,
      cwd,
      prompt: options.prompt,
      env: options.env,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onActivity: options.onActivity,
    });
    return parseAnswer(raw, options.threadIds);
  });
}
