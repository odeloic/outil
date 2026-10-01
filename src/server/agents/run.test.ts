import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANSWER_SCHEMA } from "./answer.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./fixtures.ts";
import { runAgent, stopAllRuns } from "./run.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function scratchDir(): Promise<string> {
  const dir = await makeFakeBinDir();
  dirs.push(dir);
  return dir;
}

async function fakeCli(binDir: string, name: string, script: string): Promise<void> {
  await writeFake(binDir, name, `cat > /dev/null &\n${script}\n`);
}

async function readArgv(argvFile: string): Promise<string[]> {
  const content = await readFile(argvFile, "utf8");
  return content.length === 0 ? [] : content.replace(/\n$/, "").split("\n");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("runAgent — claude", () => {
  it("passes the chosen model and the required read-only flags in argv, with the schema on --json-schema", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const argvFile = join(work, "argv.txt");
    const structuredOutput = { summary: "ok", replies: [] };
    const outputFile = join(work, "output.jsonl");
    await writeFile(
      outputFile,
      [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: structuredOutput }),
      ].join("\n") + "\n",
    );
    await fakeCli(bin, "claude", `printf '%s\\n' "$@" > '${argvFile}'\ncat '${outputFile}'\nexit 0`);

    const result = await runAgent({
      agent: "claude",
      model: "sonnet",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
    });

    expect(result).toEqual(structuredOutput);

    const argv = await readArgv(argvFile);
    expect(argv).toContain("-p");
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
    expect(argv[argv.indexOf("--json-schema") + 1]).toBe(JSON.stringify(ANSWER_SCHEMA));
    expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(argv).toContain("--no-session-persistence");
    expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("");
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).toContain("--restricted");
    expect(argv[argv.indexOf("--output-format") + 1]).toBe("stream-json");
  });

  it("turns tool_use and text blocks into activity lines", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const filePath = join(work, "sub", "file.ts");
    const events = [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: filePath } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "TODO" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "First line.\nSecond line." }] } },
      { type: "result", subtype: "success", is_error: false, structured_output: { summary: "ok", replies: [] } },
    ];
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await fakeCli(bin, "claude", `cat '${outputFile}'\nexit 0`);

    const activity: string[] = [];
    await runAgent({
      agent: "claude",
      model: "haiku",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      onActivity: (text) => activity.push(text),
    });

    expect(activity).toEqual(["Reading sub/file.ts", "Searching for TODO", "Listing **/*.ts", "First line."]);
  });

  it("fails with claude's own error message when is_error is true", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const outputFile = join(work, "output.jsonl");
    await writeFile(
      outputFile,
      JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "The prompt was refused." }) + "\n",
    );
    await fakeCli(bin, "claude", `cat '${outputFile}'\nexit 0`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: "The prompt was refused." });
  });

  it("fails with stderr text on a non-zero exit with no answer", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    await fakeCli(bin, "claude", `echo "claude blew up" >&2\nexit 2`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: expect.stringContaining("claude blew up") });
  });

  it("includes the subtype in the failure message when is_error has no result string", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }) + "\n");
    await fakeCli(bin, "claude", `cat '${outputFile}'\nexit 0`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: expect.stringContaining("error_max_turns") });
  });

  it("uses only the last non-empty stderr lines in the failure message", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    await fakeCli(bin, "claude", `printf 'line one\\n\\nline two\\nline three\\n' >&2\nexit 1`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: "line one\nline two\nline three" });
  });

  it("times out when the agent never answers, with a message naming the limit and that it was stopped", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    await fakeCli(bin, "claude", `sleep 30`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin), timeoutMs: 300 }),
    ).rejects.toMatchObject({ kind: "timeout", message: expect.stringContaining("and was stopped.") });
  });

  it("rejects an unsafe model id before spawning anything", async () => {
    await expect(
      runAgent({ agent: "claude", model: "haiku; rm -rf /", cwd: "/tmp", prompt: "hi", env: {} }),
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("rejects a model id that starts with a dash", async () => {
    await expect(
      runAgent({ agent: "claude", model: "--dangerously-skip-permissions", cwd: "/tmp", prompt: "hi", env: {} }),
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("rejects an unsupported agent id", async () => {
    await expect(
      runAgent({ agent: "gemini" as unknown as "claude", model: "haiku", cwd: "/tmp", prompt: "hi", env: {} }),
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("fails when claude exits successfully with is_error false but no structured_output", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n");
    await fakeCli(bin, "claude", `cat '${outputFile}'\nexit 0`);

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("reports claude not installed when the executable is missing", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();

    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "missing", message: "Claude Code is not installed." });
  });

  it("kills a process that ignores SIGTERM after the SIGKILL fallback", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    await fakeCli(bin, "claude", `trap '' TERM\necho $$ > '${pidFile}'\nsleep 30`);

    const controller = new AbortController();
    const running = runAgent({
      agent: "claude",
      model: "haiku",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      signal: controller.signal,
    });

    await waitFor(() => existsSync(pidFile));
    controller.abort();

    await expect(running).rejects.toMatchObject({ kind: "cancelled" });

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    await waitFor(() => !isAlive(pid), 6000);
  }, 10_000);

  it("kills the process group on timeout, not just the promise", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    await fakeCli(bin, "claude", `echo $$ > '${pidFile}'\nsleep 30`);

    const running = runAgent({
      agent: "claude",
      model: "haiku",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      timeoutMs: 2_500,
    });

    await waitFor(() => existsSync(pidFile), 8_000);
    const pid = Number((await readFile(pidFile, "utf8")).trim());

    await expect(running).rejects.toMatchObject({ kind: "timeout" });
    await waitFor(() => !isAlive(pid));
  });

  it("stopAllRuns kills a live run started via runAgent", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    await fakeCli(bin, "claude", `echo $$ > '${pidFile}'\nsleep 30`);

    const running = runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }).catch(
      (err: unknown) => err,
    );

    await waitFor(() => existsSync(pidFile));
    stopAllRuns();

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    await waitFor(() => !isAlive(pid));
    expect(await running).toMatchObject({ kind: "cancelled" });
  });

  it("settles as soon as the agent exits, even when a background child still holds its output open", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    const result = JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { summary: "ok", replies: [] } });
    await fakeCli(bin, "claude", `sleep 30 &\necho $! > '${pidFile}'\necho '${result}'\nexit 0`);

    const started = Date.now();
    await expect(
      runAgent({ agent: "claude", model: "haiku", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).resolves.toEqual({ summary: "ok", replies: [] });
    expect(Date.now() - started).toBeLessThan(10_000);

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    await waitFor(() => !isAlive(pid));
  }, 20_000);

  it("cancels via AbortSignal and kills the whole process group", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    const childPidFile = join(work, "child.txt");
    await fakeCli(bin, "claude", `echo $$ > '${pidFile}'\nsleep 30 &\necho $! > '${childPidFile}'\nwait`);

    const controller = new AbortController();
    const running = runAgent({
      agent: "claude",
      model: "haiku",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      signal: controller.signal,
    });

    await waitFor(() => existsSync(pidFile) && existsSync(childPidFile));
    controller.abort();

    await expect(running).rejects.toMatchObject({ kind: "cancelled" });

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    const childPid = Number((await readFile(childPidFile, "utf8")).trim());
    await waitFor(() => !isAlive(pid));
    await waitFor(() => !isAlive(childPid));
  });
});

describe("runAgent — codex", () => {
  it("passes the chosen model, the read-only sandbox, and the schema file on --output-schema", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const argvFile = join(work, "argv.txt");
    const capturedSchema = join(work, "captured-schema.json");
    const answer = { summary: "ok", replies: [] };
    const outputFile = join(work, "output.jsonl");
    await writeFile(
      outputFile,
      [
        JSON.stringify({ type: "thread.started", thread_id: "t" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: JSON.stringify(answer) } }),
        JSON.stringify({ type: "turn.completed", usage: {} }),
      ].join("\n") + "\n",
    );
    const script = `
printf '%s\\n' "$@" > '${argvFile}'
ARGS=("$@")
for i in "\${!ARGS[@]}"; do
  if [ "\${ARGS[$i]}" = "--output-schema" ]; then
    cp "\${ARGS[$((i+1))]}" '${capturedSchema}'
  fi
done
cat '${outputFile}'
exit 0`;
    await fakeCli(bin, "codex", script);

    const result = await runAgent({
      agent: "codex",
      model: "gpt-6.1-sol",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
    });

    expect(result).toEqual(answer);

    const argv = await readArgv(argvFile);
    expect(argv[argv.indexOf("-m") + 1]).toBe("gpt-6.1-sol");
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(argv).toContain("--skip-git-repo-check");
    expect(argv).toContain("--ephemeral");
    expect(argv).toContain("--ignore-user-config");
    expect(argv).toContain("--ignore-rules");
    expect(argv[argv.indexOf("-c") + 1]).toBe('approval_policy="never"');
    expect(argv[argv.indexOf("-C") + 1]).toBe(work);
    expect(argv.at(-1)).toBe("-");

    const schemaContent = await readFile(capturedSchema, "utf8");
    expect(JSON.parse(schemaContent)).toEqual(ANSWER_SCHEMA);
  });

  it("turns command_execution and reasoning items into activity lines, and uses the last agent_message as the answer", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const events = [
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: JSON.stringify({ summary: "draft", replies: [] }) } },
      { type: "item.completed", item: { id: "item_1", type: "reasoning" } },
      { type: "item.started", item: { id: "item_2", type: "command_execution", command: "sed -n '1,10p' a.txt" } },
      { type: "item.completed", item: { id: "item_2", type: "command_execution", command: "sed -n '1,10p' a.txt" } },
      { type: "item.completed", item: { id: "item_3", type: "agent_message", text: JSON.stringify({ summary: "final", replies: [] } ) } },
    ];
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await fakeCli(bin, "codex", `cat '${outputFile}'\nexit 0`);

    const activity: string[] = [];
    const result = await runAgent({
      agent: "codex",
      model: "gpt-6.1-sol",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      onActivity: (text) => activity.push(text),
    });

    expect(result).toEqual({ summary: "final", replies: [] });
    expect(activity).toEqual(["Thinking", "Running sed -n '1,10p' a.txt"]);
  });

  it("fails with codex's own error message on turn.failed", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, JSON.stringify({ type: "turn.failed", error: { message: "sandbox denied the write" } }) + "\n");
    await fakeCli(bin, "codex", `cat '${outputFile}'\nexit 0`);

    await expect(
      runAgent({ agent: "codex", model: "gpt-6.1-sol", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: "sandbox denied the write" });
  });

  it("fails with stderr text on a non-zero exit with no answer", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    await fakeCli(bin, "codex", `echo "codex blew up" >&2\nexit 1`);

    await expect(
      runAgent({ agent: "codex", model: "gpt-6.1-sol", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "failed", message: expect.stringContaining("codex blew up") });
  });

  it("reports an invalid kind when the final agent_message is not valid JSON", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "not json" } }) + "\n");
    await fakeCli(bin, "codex", `cat '${outputFile}'\nexit 0`);

    await expect(
      runAgent({ agent: "codex", model: "gpt-6.1-sol", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "invalid" });
  });

  it("removes its temporary schema file after the run", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const capturedDir = join(work, "captured-dir.txt");
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: JSON.stringify({ summary: "ok", replies: [] }) } }) + "\n");
    const script = `
ARGS=("$@")
for i in "\${!ARGS[@]}"; do
  if [ "\${ARGS[$i]}" = "--output-schema" ]; then
    dirname "\${ARGS[$((i+1))]}" > '${capturedDir}'
  fi
done
cat '${outputFile}'
exit 0`;
    await fakeCli(bin, "codex", script);

    await runAgent({ agent: "codex", model: "gpt-6.1-sol", cwd: work, prompt: "hello", env: fakeEnv(bin) });

    const schemaDir = (await readFile(capturedDir, "utf8")).trim();
    expect(existsSync(schemaDir)).toBe(false);
  });

  it("cancels via AbortSignal and kills the whole process group", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const pidFile = join(work, "pid.txt");
    const childPidFile = join(work, "child.txt");
    await fakeCli(bin, "codex", `echo $$ > '${pidFile}'\nsleep 30 &\necho $! > '${childPidFile}'\nwait`);

    const controller = new AbortController();
    const running = runAgent({
      agent: "codex",
      model: "gpt-6.1-sol",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      signal: controller.signal,
    });

    await waitFor(() => existsSync(pidFile) && existsSync(childPidFile));
    controller.abort();

    await expect(running).rejects.toMatchObject({ kind: "cancelled" });

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    const childPid = Number((await readFile(childPidFile, "utf8")).trim());
    await waitFor(() => !isAlive(pid));
    await waitFor(() => !isAlive(childPid));
  });

  it("reports codex not installed when the executable is missing", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();

    await expect(
      runAgent({ agent: "codex", model: "gpt-6.1-sol", cwd: work, prompt: "hello", env: fakeEnv(bin) }),
    ).rejects.toMatchObject({ kind: "missing", message: "Codex is not installed." });
  });

  it("strips the shell wrapper from Running activity, truncates long commands, and shows Thinking at most once in a row", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const longInner = "x".repeat(200);
    const events = [
      { type: "item.completed", item: { id: "item_0", type: "reasoning" } },
      { type: "item.completed", item: { id: "item_1", type: "reasoning" } },
      { type: "item.started", item: { id: "item_2", type: "command_execution", command: `/bin/zsh -lc "ls -la"` } },
      { type: "item.started", item: { id: "item_3", type: "command_execution", command: `bash -lc '${longInner}'` } },
      { type: "item.completed", item: { id: "item_4", type: "reasoning" } },
      { type: "item.completed", item: { id: "item_5", type: "agent_message", text: JSON.stringify({ summary: "ok", replies: [] }) } },
    ];
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await fakeCli(bin, "codex", `cat '${outputFile}'\nexit 0`);

    const activity: string[] = [];
    await runAgent({
      agent: "codex",
      model: "gpt-6.1-sol",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      onActivity: (text) => activity.push(text),
    });

    expect(activity).toEqual(["Thinking", "Running ls -la", `Running ${longInner.slice(0, 120)}…`, "Thinking"]);
  });

  it("unwraps -c, -lc, and -l -c shell wrappers, unescapes quoted bodies, and leaves plain commands untouched", async () => {
    const bin = await scratchDir();
    const work = await scratchDir();
    const longInner = "x".repeat(200);
    const commands = [
      `sh -c 'ls'`,
      `bash -c "ls"`,
      `/bin/bash -l -c 'ls'`,
      `bash -lc 'echo '"'"'hi'"'"''`,
      `bash -lc "grep \\"foo\\" a.ts"`,
      `git status`,
      `bash -lc '${longInner}'`,
    ];
    const events = [
      ...commands.map((command, i) => ({ type: "item.started", item: { id: `item_${i}`, type: "command_execution", command } })),
      { type: "item.completed", item: { id: "item_last", type: "agent_message", text: JSON.stringify({ summary: "ok", replies: [] }) } },
    ];
    const outputFile = join(work, "output.jsonl");
    await writeFile(outputFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await fakeCli(bin, "codex", `cat '${outputFile}'\nexit 0`);

    const activity: string[] = [];
    await runAgent({
      agent: "codex",
      model: "gpt-6.1-sol",
      cwd: work,
      prompt: "hello",
      env: fakeEnv(bin),
      onActivity: (text) => activity.push(text),
    });

    expect(activity).toEqual([
      "Running ls",
      "Running ls",
      "Running ls",
      "Running echo 'hi'",
      'Running grep "foo" a.ts',
      "Running git status",
      `Running ${longInner.slice(0, 120)}…`,
    ]);
  });
});
