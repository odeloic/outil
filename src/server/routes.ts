import { Hono } from "hono";
import type { ApiError, RepoInfo } from "../shared/api.ts";

export type RouteDeps = {
  repoInfo: () => Promise<RepoInfo>;
};

export function createRoutes({ repoInfo }: RouteDeps) {
  return new Hono().get("/api/repo", async (c) => {
    try {
      return c.json(await repoInfo(), 200);
    } catch (err) {
      const body: ApiError = { error: err instanceof Error ? err.message : String(err) };
      return c.json(body, 500);
    }
  });
}

export type AppType = ReturnType<typeof createRoutes>;
