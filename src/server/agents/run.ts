import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import type { AgentId } from "../../shared/api.ts";
import { MODEL_PATTERN } from "../../shared/agents.ts";
import { ANSWER_SCHEMA } from "./answer.ts";
import { AgentRunError } from "./errors.ts";

export type RunAgentOptions = {
  agent: AgentId;
  model: string;
  cwd: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onActivity?: (text: string) => void;
};

type LiveRun = { pid: number; stop: () => void };

const liveRuns = new Set<LiveRun>();

export function stopAllRuns(): void {
  for (const run of liveRuns) run.stop();
}

process.on("exit", () => {
  for (const run of liveRuns) {
    try {
      process.kill(-run.pid, "SIGKILL");
    } catch {
      continue;
    }
  }
});

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} minute${ms >= 90_000 ? "s" : ""}`;
  return `${Math.max(1, Math.round(ms / 1000))} second${ms >= 1_500 ? "s" : ""}`;
}

const STDERR_CAP = 4_096;

function lastNonEmptyLines(text: string, count = 5): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-count)
    .join("\n");
}

type ProcessResult = { code: number | null; stderr: string };

function runProcess(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    input: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    notFoundMessage: string;
    onLine: (line: string) => void;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new AgentRunError("cancelled", "The run was cancelled."));
      return;
    }

    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const pid = child.pid;
    let stderr = "";
    let settled = false;
    let pendingRejection: AgentRunError | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const entry: LiveRun | null = pid ? { pid, stop: onAbort } : null;
    if (entry) liveRuns.add(entry);

    function signalGroup(signal: NodeJS.Signals) {
      if (!pid) return;
      try {
        process.kill(-pid, signal);
      } catch {
        return;
      }
    }

    function killGroup() {
      if (killTimer) return;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), 3_000);
      killTimer.unref();
    }

    function cleanup() {
      if (entry) liveRuns.delete(entry);
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      rl.close();
    }

    function onAbort() {
      if (settled || pendingRejection) return;
      pendingRejection = new AgentRunError("cancelled", "The run was cancelled.");
      killGroup();
    }
    opts.signal?.addEventListener("abort", onAbort);

    if (opts.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        if (settled || pendingRejection) return;
        pendingRejection = new AgentRunError("timeout", `The agent did not answer within ${formatDuration(opts.timeoutMs!)} and was stopped.`);
        killGroup();
      }, opts.timeoutMs);
    }

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (settled) return;
      if (line.trim() === "") return;
      try {
        opts.onLine(line);
      } catch {
        return;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_CAP);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err.code === "ENOENT" ? new AgentRunError("missing", opts.notFoundMessage) : new AgentRunError("failed", err.message));
    });

    child.on("exit", () => signalGroup("SIGKILL"));

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signalGroup("SIGKILL");
      cleanup();
      if (pendingRejection) reject(pendingRejection);
      else resolve({ code, stderr });
    });

    child.stdin.on("error", () => undefined);
    child.stdin.write(opts.input);
    child.stdin.end();
  });
}

function claudeActivity(event: Record<string, unknown>, cwd: string): string[] {
  if (event.type !== "assistant") return [];
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const typed = block as Record<string, unknown>;
    if (typed.type === "tool_use") {
      lines.push(claudeToolActivity(typed, cwd));
    } else if (typed.type === "text" && typeof typed.text === "string") {
      const first = typed.text.split("\n")[0].trim();
      if (first !== "") lines.push(first);
    }
  }
  return lines;
}

function claudeToolActivity(block: Record<string, unknown>, cwd: string): string {
  const input = (block.input as Record<string, unknown>) ?? {};
  switch (block.name) {
    case "Read": {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      return `Reading ${filePath ? relative(cwd, filePath) : "a file"}`;
    }
    case "Grep":
      return `Searching for ${String(input.pattern ?? "")}`;
    case "Glob":
      return `Listing ${String(input.pattern ?? "")}`;
    case "StructuredOutput":
      return "Writing replies";
    default:
      return `Using ${String(block.name ?? "a tool")}`;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHELL_WRAPPER_PATTERN = /^(?:\S*\/)?(?:zsh|bash|sh)\s+(?:-c|-lc|-l\s+-c)\s+(['"])([\s\S]*)\1$/;
const MAX_COMMAND_CHARS = 120;

function unescapeShellBody(quote: string, body: string): string {
  if (quote === "'") return body.replace(/'"'"'|'\\''/g, "'");
  return body.replace(/\\(["\\$`])/g, "$1");
}

function formatCodexCommand(command: string): string {
  const trimmed = command.trim();
  const match = SHELL_WRAPPER_PATTERN.exec(trimmed);
  const text = match ? unescapeShellBody(match[1], match[2]) : trimmed;
  const chars = Array.from(text);
  return chars.length > MAX_COMMAND_CHARS ? `${chars.slice(0, MAX_COMMAND_CHARS).join("")}…` : text;
}

async function runClaude(options: RunAgentOptions): Promise<unknown> {
  const env = options.env ?? process.env;
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(ANSWER_SCHEMA),
    "--model",
    options.model,
    "--tools",
    "Read,Grep,Glob",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--restricted",
  ];

  let result: unknown;
  let errorMessage: string | null = null;

  const { code, stderr } = await runProcess("claude", args, {
    cwd: options.cwd,
    env,
    input: options.prompt,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    notFoundMessage: "Claude Code is not installed.",
    onLine: (line) => {
      const event: unknown = JSON.parse(line);
      if (!isPlainObject(event)) return;
      for (const text of claudeActivity(event, options.cwd)) options.onActivity?.(text);
      if (event.type === "result") {
        if (event.is_error) {
          errorMessage =
            typeof event.result === "string" ? event.result : `Claude Code reported an error (${String(event.subtype ?? "unknown")}).`;
        } else {
          result = event.structured_output;
        }
      }
    },
  });

  if (errorMessage) throw new AgentRunError("failed", errorMessage);
  if (result === undefined) {
    throw new AgentRunError("failed", lastNonEmptyLines(stderr) || `claude exited with code ${code} without an answer.`);
  }
  return result;
}

async function runCodex(options: RunAgentOptions): Promise<unknown> {
  const env = options.env ?? process.env;
  const schemaDir = await mkdtemp(join(tmpdir(), "outil-codex-schema-"));
  const schemaFile = join(schemaDir, "schema.json");
  await writeFile(schemaFile, JSON.stringify(ANSWER_SCHEMA));

  try {
    const args = [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      'approval_policy="never"',
      "--output-schema",
      schemaFile,
      "-m",
      options.model,
      "-C",
      options.cwd,
      "-",
    ];

    let resultText: string | undefined;
    let failure: string | null = null;
    let lastError: string | null = null;
    let lastActivity: string | null = null;

    function pushActivity(text: string) {
      if (text === "Thinking" && lastActivity === "Thinking") return;
      lastActivity = text;
      options.onActivity?.(text);
    }

    const { code, stderr } = await runProcess("codex", args, {
      cwd: options.cwd,
      env,
      input: options.prompt,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      notFoundMessage: "Codex is not installed.",
      onLine: (line) => {
        const event: unknown = JSON.parse(line);
        if (!isPlainObject(event)) return;
        const item = isPlainObject(event.item) ? event.item : undefined;
        if (event.type === "item.started" && item?.type === "command_execution" && typeof item.command === "string") {
          pushActivity(`Running ${formatCodexCommand(item.command)}`);
        }
        if (event.type === "item.completed" && item) {
          if (item.type === "reasoning") {
            pushActivity("Thinking");
          } else if (item.type === "agent_message" && typeof item.text === "string") {
            resultText = item.text;
          }
        }
        if (event.type === "turn.failed") {
          const err = isPlainObject(event.error) ? event.error : undefined;
          failure = typeof err?.message === "string" ? err.message : "Codex reported an error.";
        }
        if (event.type === "error") {
          lastError = typeof event.message === "string" ? event.message : "Codex reported an error.";
        }
      },
    });

    if (failure) throw new AgentRunError("failed", failure);
    if (resultText === undefined) {
      throw new AgentRunError("failed", lastError ?? (lastNonEmptyLines(stderr) || `codex exited with code ${code} without an answer.`));
    }
    try {
      return JSON.parse(resultText);
    } catch {
      throw new AgentRunError("invalid", "not valid JSON");
    }
  } finally {
    await rm(schemaDir, { recursive: true, force: true });
  }
}

export async function runAgent(options: RunAgentOptions): Promise<unknown> {
  if (!MODEL_PATTERN.test(options.model)) {
    throw new AgentRunError("failed", `"${options.model}" is not a valid model id.`);
  }
  switch (options.agent) {
    case "claude":
      return runClaude(options);
    case "codex":
      return runCodex(options);
    default:
      throw new AgentRunError("failed", `"${String(options.agent)}" is not a supported agent.`);
  }
}
