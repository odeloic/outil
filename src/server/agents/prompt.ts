import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeSet, CommitDetails, Review, Run, Thread, ThreadMessage } from "../../shared/api.ts";

const exec = promisify(execFile);

const SNIPPET_CONTEXT = 3;
const MAX_LINE_CHARS = 500;
const MAX_PROMPT_CHARS = 200_000;

export type PromptSnippetLine = { number: number; text: string; marked: boolean };
export type PromptSnippet = PromptSnippetLine[] | null;

export type PromptContext = {
  headSubject: string;
  snippets: Map<string, PromptSnippet>;
};

async function showFile(repoRoot: string, sha: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["show", `${sha}:${path}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

function clip(text: string): string {
  return text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
}

function excerpt(content: string, startLine: number, endLine: number): PromptSnippet {
  const lines = content.split("\n");
  const from = Math.max(1, startLine - SNIPPET_CONTEXT);
  const to = Math.min(lines.length, endLine + SNIPPET_CONTEXT);
  const out: PromptSnippetLine[] = [];
  for (let n = from; n <= to; n++) {
    out.push({ number: n, text: clip(lines[n - 1] ?? ""), marked: n >= startLine && n <= endLine });
  }
  return out;
}

export async function promptContext(
  repoRoot: string,
  review: Review,
  getCommit: (sha: string) => Promise<CommitDetails>,
  listChanges: (base: string | null, head: string) => Promise<ChangeSet>,
): Promise<PromptContext> {
  const headCommit = await getCommit(review.head);

  const oldPathFor = new Map<string, string>();
  const hasOldSide = review.threads.some((thread) => thread.anchor.side === "old");
  if (hasOldSide && review.base) {
    const changes = await listChanges(review.base, review.head);
    for (const file of changes.files) {
      if (file.oldPath) oldPathFor.set(file.path, file.oldPath);
    }
  }

  const snippets = new Map<string, PromptSnippet>();
  for (const thread of review.threads) {
    const sha = thread.anchor.side === "new" ? review.head : review.base;
    if (!sha) {
      snippets.set(thread.id, null);
      continue;
    }
    const path = thread.anchor.side === "old" ? (oldPathFor.get(thread.anchor.path) ?? thread.anchor.path) : thread.anchor.path;
    const content = await showFile(repoRoot, sha, path);
    snippets.set(thread.id, content === null ? null : excerpt(content, thread.anchor.startLine, thread.anchor.endLine));
  }
  return { headSubject: headCommit.subject, snippets };
}

function threadHeader(thread: Thread): string {
  const suffix = thread.resolved ? " (resolved, for context only)" : "";
  return `Thread ${thread.id} — ${thread.anchor.path}, ${thread.anchor.side} line(s) ${thread.anchor.startLine}-${thread.anchor.endLine}${suffix}`;
}

function snippetBlock(snippet: PromptSnippet): string {
  if (!snippet || snippet.length === 0) return "(source not available)";
  return snippet.map((line) => `${line.marked ? ">" : " "} ${line.number}: ${line.text}`).join("\n");
}

function messageLine(message: ThreadMessage): string {
  if (message.author === "reviewer") return `Reviewer: ${message.body}`;
  return `Agent (${message.agent} · ${message.model}): ${message.body}`;
}

const RESOLVED_OMITTED = "(snippet and message history omitted to keep the prompt within budget; this thread is resolved)";
const OLDER_MESSAGES_OMITTED = "(earlier messages omitted to keep the prompt within budget)";
const SNIPPET_OMITTED = "(snippet omitted to keep the prompt within budget)";

type TrimStage = 0 | 1 | 2 | 3;

function renderThread(thread: Thread, snippet: PromptSnippet, needsReply: boolean, stage: TrimStage): string {
  const lines = [threadHeader(thread)];
  const collapseResolved = stage >= 1 && thread.resolved;
  const trimOlder = stage >= 2 && !thread.resolved && !needsReply;
  const omitAllSnippets = stage >= 3;

  if (collapseResolved) {
    lines.push(RESOLVED_OMITTED);
  } else {
    lines.push(omitAllSnippets ? SNIPPET_OMITTED : snippetBlock(snippet));
    if (trimOlder && thread.messages.length > 1) {
      lines.push(OLDER_MESSAGES_OMITTED);
      lines.push(messageLine(thread.messages[thread.messages.length - 1]));
    } else {
      lines.push(...thread.messages.map(messageLine));
    }
  }
  if (needsReply) lines.push("Needs a reply.");
  return lines.join("\n");
}

function buildHeader(review: Review, context: PromptContext): string {
  const header: string[] = [];
  if (review.target.kind === "commit") {
    header.push(`Reviewing commit ${review.target.sha} "${context.headSubject}".`);
  } else {
    header.push(`Reviewing changes from ${review.target.base} to ${review.target.head}.`);
  }
  header.push("Do not modify any file.");
  header.push(`Your working directory is a read-only snapshot of commit ${review.head}.`);
  if (review.base) {
    header.push(`The old side of the diff is from commit ${review.base} and is shown only in the code snippets below.`);
  }
  return header.join("\n");
}

const CONTRACT = [
  'Answer every thread marked "Needs a reply." below exactly once, keyed by its thread id.',
  'Do not answer threads that are not marked "Needs a reply.".',
  "Replies should be actionable review feedback about the code the thread is anchored to.",
  "Also include a short overall summary of the review.",
  "In the summary, refer to threads by file and line, never by thread id.",
].join("\n");

const REMINDER = 'Reminder: reply once to every thread marked "Needs a reply." above, keyed by its id, plus a short summary.';

export function buildPrompt(review: Review, context: PromptContext, run: Pick<Run, "threadIds">, maxChars = MAX_PROMPT_CHARS): string {
  const needsReplySet = new Set(run.threadIds);
  const header = buildHeader(review, context);

  const render = (stage: TrimStage): string => {
    const blocks = review.threads.map((thread) =>
      renderThread(thread, context.snippets.get(thread.id) ?? null, !thread.resolved && needsReplySet.has(thread.id), stage),
    );
    return [header, CONTRACT, ...blocks, REMINDER].join("\n\n");
  };

  for (const stage of [0, 1, 2, 3] as const) {
    const prompt = render(stage);
    if (prompt.length <= maxChars || stage === 3) return prompt;
  }
  return render(3);
}
