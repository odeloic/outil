import { AgentRunError } from "./errors.ts";

export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    replies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          body: { type: "string" },
        },
        required: ["threadId", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "replies"],
  additionalProperties: false,
} as const;

export type AnswerReply = { threadId: string; body: string };

export type ParsedAnswer = {
  summary: string;
  replies: AnswerReply[];
  unanswered: string[];
};

function isRawReply(value: unknown): value is AnswerReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.threadId === "string" && typeof reply.body === "string";
}

export function parseAnswer(raw: unknown, sentThreadIds: string[]): ParsedAnswer {
  if (typeof raw !== "object" || raw === null) {
    throw new AgentRunError("invalid", "The agent's answer was not a JSON object.");
  }
  const { summary, replies } = raw as Record<string, unknown>;
  if (typeof summary !== "string") {
    throw new AgentRunError("invalid", "The agent's answer is missing a summary.");
  }
  if (!Array.isArray(replies) || !replies.every(isRawReply)) {
    throw new AgentRunError("invalid", "The agent's answer has malformed replies.");
  }

  const sent = new Set(sentThreadIds);
  const kept: AnswerReply[] = [];
  const answered = new Set<string>();
  for (const reply of replies) {
    if (!sent.has(reply.threadId) || answered.has(reply.threadId)) continue;
    const body = reply.body.trim();
    if (body === "") continue;
    answered.add(reply.threadId);
    kept.push({ threadId: reply.threadId, body });
  }

  return { summary, replies: kept, unanswered: sentThreadIds.filter((id) => !answered.has(id)) };
}
