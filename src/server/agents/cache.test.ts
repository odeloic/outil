import { describe, expect, it } from "vitest";
import type { AgentStatus } from "../../shared/api.ts";
import { createAgentCache } from "./cache.ts";

const agents: AgentStatus[] = [{ id: "claude", name: "Claude Code", state: "ready", fix: null }];

describe("createAgentCache", () => {
  it("caches the detection result across calls", async () => {
    let calls = 0;
    const cache = createAgentCache(async () => {
      calls++;
      return agents;
    });

    expect(await cache.list()).toEqual(agents);
    expect(await cache.list()).toEqual(agents);
    expect(calls).toBe(1);
  });

  it("re-detects when refresh is true", async () => {
    let calls = 0;
    const cache = createAgentCache(async () => {
      calls++;
      return agents;
    });

    await cache.list();
    await cache.list(true);
    expect(calls).toBe(2);
  });

  it("shares one in-flight detection promise between concurrent calls", async () => {
    let calls = 0;
    let resolve!: (value: AgentStatus[]) => void;
    const cache = createAgentCache(() => {
      calls++;
      return new Promise((res) => {
        resolve = res;
      });
    });

    const first = cache.list();
    const second = cache.list();
    await new Promise((r) => setTimeout(r, 0));
    resolve(agents);
    expect(await first).toEqual(agents);
    expect(await second).toEqual(agents);
    expect(calls).toBe(1);
  });

  it("does not cache a failed detection, so the next call retries", async () => {
    let calls = 0;
    const cache = createAgentCache(async () => {
      calls++;
      if (calls === 1) throw new Error("detection failed");
      return agents;
    });

    await expect(cache.list()).rejects.toThrow("detection failed");
    expect(await cache.list()).toEqual(agents);
    expect(calls).toBe(2);
  });
});
