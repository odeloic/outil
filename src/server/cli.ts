#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import app from "./app.ts";
import { openBrowser } from "./open.ts";

// Built layout: dist/server/cli.js serves the client from dist/client
const clientDir = fileURLToPath(new URL("../client", import.meta.url));
const hostname = "127.0.0.1";
const preferredPort = Number(process.env.PORT ?? 4747);

const server = new Hono()
  .route("/", app)
  .use("*", serveStatic({ root: clientDir }));

function listen(port: number) {
  const http = serve({ fetch: server.fetch, hostname, port }, (info) => {
    const url = `http://${hostname}:${info.port}`;
    console.log(`outil running at ${url}`);
    openBrowser(url);
  });
  http.once("error", (err: NodeJS.ErrnoException) => {
    // Another outil (or anything else) is on the preferred port: let the OS pick one
    if (err.code === "EADDRINUSE" && port !== 0) return listen(0);
    throw err;
  });
}

listen(preferredPort);
