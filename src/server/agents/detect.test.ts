import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { detectAgents } from "./detect.ts";
import { fakeEnv, makeFakeBinDir, writeFake } from "./fixtures.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fakeDir(): Promise<string> {
  const dir = await makeFakeBinDir();
  dirs.push(dir);
  return dir;
}

describe("detectAgents", () => {
  it("reports both agents as not installed when their executables are absent", async () => {
    const dir = await fakeDir();

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses.map((s) => [s.id, s.state])).toEqual([
      ["claude", "not-installed"],
      ["codex", "not-installed"],
    ]);
    expect(statuses[0].fix).toContain("npm install -g @anthropic-ai/claude-code");
    expect(statuses[1].fix).toContain("npm install -g @openai/codex");
  });

  it("reports an installed agent that is not signed in", async () => {
    const dir = await fakeDir();
    await writeFake(dir, "claude", `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn": false}'; exit 1; fi\nexit 1\n`);
    await writeFake(dir, "codex", `if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Not logged in"; exit 1; fi\nexit 1\n`);

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses.map((s) => [s.id, s.state])).toEqual([
      ["claude", "signed-out"],
      ["codex", "signed-out"],
    ]);
    expect(statuses[0].fix).toContain("claude auth login");
    expect(statuses[1].fix).toContain("codex login");
  });

  it("reports an installed, signed-in agent as ready", async () => {
    const dir = await fakeDir();
    await writeFake(dir, "claude", `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn": true}'; exit 0; fi\nexit 1\n`);
    await writeFake(dir, "codex", `if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi\nexit 1\n`);

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses.map((s) => [s.id, s.state, s.fix])).toEqual([
      ["claude", "ready", null],
      ["codex", "ready", null],
    ]);
  });

  it("reports codex as signed out when its status check fails, whatever it prints", async () => {
    const dir = await fakeDir();
    await writeFake(dir, "codex", `if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 1; fi\nexit 1\n`);

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses[1].state).toBe("signed-out");
  });

  it("treats a slow or hanging auth check as signed out", async () => {
    const dir = await fakeDir();
    await writeFake(dir, "claude", `if [ "$1" = "auth" ]; then sleep 30; fi\nexit 1\n`);

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses[0].state).toBe("signed-out");
  }, 15_000);

  it("never detects, lists, or runs gemini even when a gemini executable is installed", async () => {
    const dir = await fakeDir();
    await writeFake(dir, "claude", `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn": true}'; exit 0; fi\nexit 1\n`);
    await writeFake(dir, "codex", `if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi\nexit 1\n`);
    await writeFake(dir, "gemini", `echo '{"loggedIn": true}'\nexit 0\n`);

    const statuses = await detectAgents(fakeEnv(dir));

    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.id)).toEqual(["claude", "codex"]);
  });
});
