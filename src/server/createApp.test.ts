import { describe, expect, it } from "vitest";
import { AgentRunError } from "./agents/errors.ts";
import { isAgentMissingError, parseAgentTimeoutMs } from "./createApp.ts";

describe("parseAgentTimeoutMs", () => {
  it("reads a positive integer from OUTIL_AGENT_TIMEOUT_MS", () => {
    expect(parseAgentTimeoutMs({ OUTIL_AGENT_TIMEOUT_MS: "3000" })).toBe(3000);
  });

  it("falls back to the default when the variable is missing", () => {
    expect(parseAgentTimeoutMs({})).toBeUndefined();
  });

  it("falls back to the default for a non-numeric, zero, negative, or fractional value", () => {
    for (const value of ["nope", "0", "-100", "1.5", ""]) {
      expect(parseAgentTimeoutMs({ OUTIL_AGENT_TIMEOUT_MS: value })).toBeUndefined();
    }
  });
});

describe("isAgentMissingError", () => {
  it("is true for a missing-binary AgentRunError", () => {
    expect(isAgentMissingError(new AgentRunError("missing", "Claude Code is not installed."))).toBe(true);
    expect(isAgentMissingError(new AgentRunError("missing", "Codex is not installed."))).toBe(true);
  });

  it("is false for other failures or error kinds", () => {
    expect(isAgentMissingError(new AgentRunError("failed", "The prompt was refused."))).toBe(false);
    expect(isAgentMissingError(new AgentRunError("failed", "is not installed"))).toBe(false);
    expect(isAgentMissingError(new AgentRunError("timeout", "too slow"))).toBe(false);
    expect(isAgentMissingError(new Error("is not installed"))).toBe(false);
    expect(isAgentMissingError(null)).toBe(false);
  });
});
