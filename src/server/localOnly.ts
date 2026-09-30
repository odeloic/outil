import type { MiddlewareHandler } from "hono";

export function localOnly(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";
    const allowed = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!allowed.includes(host.toLowerCase())) return c.text("outil only answers requests from this machine.", 403);
    await next();
  };
}
