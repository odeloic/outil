import { parseArgs } from "node:util";

export const USAGE = `Usage: outil [options] [<commit>]
       outil [options] <base> <head>

Opens a review of a commit (the latest one by default), or of the changes
between two commits or branches, in your browser.

Options:
  --port <number>  Preferred port (default 4747; a free port is used if it is taken)
  --no-open        Print the address without opening the browser
  -h, --help       Show this help
  -v, --version    Show the version`;

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "review"; refs: string[]; port: number; open: boolean };

export class UsageError extends Error {}

export function parseCli(argv: string[]): CliCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        port: { type: "string" },
        open: { type: "boolean", default: true },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (positionals.length > 2) throw new UsageError("Give at most two references: a commit, or a base and a head.");

  const port = values.port === undefined ? 4747 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`"${values.port}" is not a valid port.`);
  return { kind: "review", refs: positionals, port, open: values.open };
}
