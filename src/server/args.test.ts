import { describe, expect, it } from "vitest";
import { parseCli, UsageError } from "./args.ts";

describe("parseCli", () => {
  it("reviews the latest commit by default, on the default port, opening the browser", () => {
    expect(parseCli([])).toEqual({ kind: "review", refs: [], port: 4747, open: true });
  });

  it("takes one reference for a commit or two for a comparison", () => {
    expect(parseCli(["main~2"])).toMatchObject({ refs: ["main~2"] });
    expect(parseCli(["main", "feature/x"])).toMatchObject({ refs: ["main", "feature/x"] });
  });

  it("reads the port and the --no-open flag", () => {
    expect(parseCli(["--port", "5000", "--no-open", "HEAD"])).toEqual({
      kind: "review",
      refs: ["HEAD"],
      port: 5000,
      open: false,
    });
  });

  it("recognises help and version", () => {
    expect(parseCli(["--help"])).toEqual({ kind: "help" });
    expect(parseCli(["-h"])).toEqual({ kind: "help" });
    expect(parseCli(["-v"])).toEqual({ kind: "version" });
  });

  it("rejects extra references, bad ports, and unknown options", () => {
    for (const argv of [["a", "b", "c"], ["--port", "abc"], ["--port", "70000"], ["--nope"]]) {
      expect(() => parseCli(argv)).toThrow(UsageError);
    }
  });
});
