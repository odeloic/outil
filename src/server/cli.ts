#!/usr/bin/env node
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { stopAllRuns } from "./agents/run.ts";
import { parseCli, USAGE, UsageError } from "./args.ts";
import { createApp, stopAllRunners } from "./createApp.ts";
import { RefError } from "./errors.ts";
import { getRepoInfo, resolveCommit } from "./git.ts";
import { localOnly } from "./localOnly.ts";
import { openBrowser } from "./open.ts";

const clientDir = fileURLToPath(new URL("../client", import.meta.url));
const packageJson = fileURLToPath(new URL("../../package.json", import.meta.url));
const hostname = "127.0.0.1";

function fail(message: string): never {
  console.error(`outil: ${message}`);
  process.exit(1);
}

function explainRepoError(err: NodeJS.ErrnoException & { stderr?: string }): string {
  if (err.code === "ENOENT") return "git is not installed, or it is not on your PATH.";
  const reason = err.stderr?.trim().replace(/^fatal: /, "") ?? err.message;
  if (/not a git repository/i.test(reason)) return "this is not a git repository. Run outil from inside one.";
  return `git could not open this repository: ${reason}`;
}

async function reviewParams(root: string, refs: string[]): Promise<Record<string, string>> {
  try {
    if (refs.length === 2) {
      const [base, head] = await Promise.all(refs.map((ref) => resolveCommit(root, ref)));
      return { base, head };
    }
    return { ref: await resolveCommit(root, refs[0] ?? "HEAD") };
  } catch (err) {
    if (err instanceof RefError) fail(err.message);
    throw err;
  }
}

function start(root: string, preferredPort: number, params: Record<string, string>, open: boolean) {
  let port = preferredPort;
  const app = new Hono()
    .use("*", localOnly(() => port))
    .route("/", createApp(root))
    .use("*", serveStatic({ root: clientDir }));

  const listen = (candidate: number) => {
    const server = serve({ fetch: app.fetch, hostname, port: candidate }, (info) => {
      port = info.port;
      const url = `http://${hostname}:${port}/?${new URLSearchParams(params)}`;
      console.log(`outil is reviewing ${root}`);
      if (candidate !== preferredPort) console.log(`Port ${preferredPort} is busy, so outil is using port ${port}.`);
      console.log(`Open ${url}`);
      console.log("Press Ctrl+C to stop.");
      if (open) openBrowser(url);
      stopOnSignal(server as Server);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && candidate !== 0) return listen(0);
      fail(`could not start the server: ${err.message}`);
    });
  };
  listen(preferredPort);
}

const STOP_TIMEOUT_MS = 4_000;

function stopOnSignal(server: Server) {
  const stop = () => {
    console.log("\nStopped.");
    stopAllRuns();
    server.close();
    server.closeAllConnections();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
    void Promise.race([stopAllRunners(), timeout]).then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main() {
  let command;
  try {
    command = parseCli(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) fail(`${err.message}\n\n${USAGE}`);
    throw err;
  }
  if (command.kind === "help") return console.log(USAGE);
  if (command.kind === "version") return console.log(JSON.parse(readFileSync(packageJson, "utf8")).version);

  const root = await getRepoInfo(process.cwd()).then(
    (info) => info.root,
    (err: NodeJS.ErrnoException & { stderr?: string }) => fail(explainRepoError(err)),
  );
  const params = await reviewParams(root, command.refs);
  start(root, command.port, params, command.open);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
