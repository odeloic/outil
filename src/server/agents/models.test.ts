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

  it("offers claude's effort levels on every model except haiku, defaulting to high", async () => {
    const models = await listModels("claude");
    for (const model of models.filter((m) => m.id !== "haiku")) {
      expect(model.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(model.defaultEffort).toBe("high");
    }
    expect(models.find((m) => m.id === "haiku")?.efforts).toEqual([]);
  });

  it("drops codex effort levels that are malformed or missing an effort key", async () => {
    const dir = await fakeDir();
    const payload = {
      models: [
        {
          slug: "gpt-6.1-sol",
          display_name: "GPT-6.1-Sol",
          visibility: "list",
          priority: 1,
          default_reasoning_level: "--bad",
          supported_reasoning_levels: [{ effort: "low" }, { description: "no key" }, { effort: 3 }, { effort: "--bad" }, { effort: "High" }, null, { effort: "max" }],
        },
        { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", priority: 2 },
      ],
    };
    await writeFake(dir, "codex", `if [ "$1" = "debug" ] && [ "$2" = "models" ]; then cat <<'JSON'\n${JSON.stringify(payload)}\nJSON\nexit 0\nfi\nexit 1\n`);

    const models = await listModels("codex", fakeEnv(dir));

    expect(models).toEqual([
      { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", efforts: ["low", "max"], defaultEffort: null },
      { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: [], defaultEffort: null },
    ]);
  });

  it("falls back to codex's medium effort when the default level is absent or not offered", async () => {
    const dir = await fakeDir();
    const levels = (...efforts: string[]) => efforts.map((effort) => ({ effort }));
    const payload = {
      models: [
        { slug: "absent", display_name: "Absent", visibility: "list", priority: 1, supported_reasoning_levels: levels("low", "medium") },
        { slug: "not-offered", display_name: "Not Offered", visibility: "list", priority: 2, default_reasoning_level: "ultra", supported_reasoning_levels: levels("low", "medium") },
        { slug: "no-medium", display_name: "No Medium", visibility: "list", priority: 3, default_reasoning_level: "ultra", supported_reasoning_levels: levels("low", "high") },
      ],
    };
    await writeFake(dir, "codex", `if [ "$1" = "debug" ] && [ "$2" = "models" ]; then cat <<'JSON'\n${JSON.stringify(payload)}\nJSON\nexit 0\nfi\nexit 1\n`);

    const models = await listModels("codex", fakeEnv(dir));

    expect(models.map((model) => model.defaultEffort)).toEqual(["medium", "medium", null]);
  });

  it("lists codex's models from `codex debug models`, hiding non-listed ones and ordering by priority", async () => {
    const dir = await fakeDir();
    const payload = {
      models: [
        { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list", priority: 8, supported_reasoning_levels: [{ effort: "low" }] },
        {
          slug: "gpt-6.1-sol",
          display_name: "GPT-6.1-Sol",
          visibility: "list",
          priority: 1,
          default_reasoning_level: "low",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "ultra" }],
        },
        { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 4 },
        { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide", priority: 43 },
        { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", priority: 4, default_reasoning_level: "xhigh", supported_reasoning_levels: [{ effort: "low" }] },
      ],
    };
    await writeFake(dir, "codex", `if [ "$1" = "debug" ] && [ "$2" = "models" ]; then cat <<'JSON'\n${JSON.stringify(payload)}\nJSON\nexit 0\nfi\nexit 1\n`);

    const models = await listModels("codex", fakeEnv(dir));

    expect(models).toEqual([
      { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", efforts: ["low", "medium", "ultra"], defaultEffort: "low" },
      { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: ["low"], defaultEffort: null },
      { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", efforts: ["low"], defaultEffort: null },
    ]);
  });
});
