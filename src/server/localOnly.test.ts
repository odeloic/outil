import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { localOnly } from "./localOnly.ts";

describe("localOnly", () => {
  const app = new Hono().use("*", localOnly(() => 4747)).get("/", (c) => c.text("ok"));
  const request = (host: string) => app.request("/", { headers: { host } });

  it("answers requests addressed to this machine on the served port", async () => {
    expect((await request("127.0.0.1:4747")).status).toBe(200);
    expect((await request("localhost:4747")).status).toBe(200);
  });

  it("refuses requests addressed to any other host or port", async () => {
    for (const host of ["evil.example:4747", "127.0.0.1:80", "192.168.1.10:4747", ""]) {
      expect((await request(host)).status).toBe(403);
    }
  });
});
