import { Hono } from "hono";
import type { ApiError } from "../shared/api.ts";
import { getRepoInfo } from "./git.ts";

const app = new Hono();

app.get("/api/repo", async (c) => {
  try {
    return c.json(await getRepoInfo(process.cwd()));
  } catch (err) {
    const body: ApiError = { error: err instanceof Error ? err.message : String(err) };
    return c.json(body, 500);
  }
});

export default app;
