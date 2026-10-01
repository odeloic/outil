import type { AgentId, AgentModel, AgentStatus } from "../../shared/api.ts";

export type AgentCache = {
  list(refresh?: boolean): Promise<AgentStatus[]>;
  invalidate(): void;
};

export function createAgentCache(detect: () => Promise<AgentStatus[]>): AgentCache {
  let cached: Promise<AgentStatus[]> | null = null;
  return {
    list(refresh = false) {
      if (refresh || !cached) {
        const attempt = detect();
        cached = attempt;
        attempt.catch(() => {
          if (cached === attempt) cached = null;
        });
      }
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}

export type ModelsCache = {
  list(agent: AgentId, refresh?: boolean): Promise<AgentModel[]>;
};

export function createModelsCache(listModels: (agent: AgentId) => Promise<AgentModel[]>): ModelsCache {
  const cache = new Map<AgentId, Promise<AgentModel[]>>();
  return {
    list(agent, refresh = false) {
      if (refresh || !cache.has(agent)) {
        const attempt = listModels(agent);
        cache.set(agent, attempt);
        attempt.catch(() => {
          if (cache.get(agent) === attempt) cache.delete(agent);
        });
      }
      return cache.get(agent)!;
    },
  };
}
