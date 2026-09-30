export type AgentRunErrorKind = "failed" | "timeout" | "cancelled" | "invalid";

export class AgentRunError extends Error {
  readonly kind: AgentRunErrorKind;

  constructor(kind: AgentRunErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
