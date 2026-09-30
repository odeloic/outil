import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { listModels } from "./models.ts";
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

describe("listModels", () => {
  it("lists claude's fixed model aliases", async () => {
    const models = await listModels("claude");
    expect(models.map((m) => m.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
  });

  it("lists codex's models from `codex debug models`, hiding non-listed ones and ordering by priority", async () => {
    const dir = await fakeDir();
    const payload = {
      models: [
        { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list", priority: 8 },
        { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", priority: 1 },
        { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 4 },
        { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide", priority: 43 },
        { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", priority: 4 },
      ],
    };
    await writeFake(dir, "codex", `if [ "$1" = "debug" ] && [ "$2" = "models" ]; then cat <<'JSON'\n${JSON.stringify(payload)}\nJSON\nexit 0\nfi\nexit 1\n`);

    const models = await listModels("codex", fakeEnv(dir));

    expect(models).toEqual([
      { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
      { id: "gpt-6-luna", label: "GPT-6-Luna" },
      { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
    ]);
  });
});
