import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeSet, Review, Thread, ThreadMessage } from "../../shared/api.ts";
import { getCommit, listChanges } from "../git.ts";
import { buildPrompt, promptContext, type PromptContext, type PromptSnippet } from "./prompt.ts";

const noRenames = async (): Promise<ChangeSet> => ({ base: null, head: "", files: [], additions: 0, deletions: 0 });

const sha = "a".repeat(40);
const base = "b".repeat(40);

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    anchor: { path: "src/a.ts", side: "new", startLine: 10, endLine: 10 },
    messages: [{ id: "m1", author: "reviewer", body: "What does this do?", createdAt: "d", state: "sent" }],
    resolved: false,
    createdAt: "d",
    ...overrides,
  };
}

function runningRun(overrides: Partial<Review["runs"][number]> = {}) {
  return {
    id: "r1",
    agent: "claude" as const,
    model: "haiku",
    effort: null,
    state: "running" as const,
    threadIds: ["t1"],
    startedAt: "d",
    endedAt: null,
    summary: null,
    error: null,
    owner: null,
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    key: sha,
    target: { kind: "commit", sha },
    base,
    head: sha,
    threads: [thread()],
    runs: [runningRun()],
    nextThread: 2,
    revision: 0,
    generation: "g1",
    ...overrides,
  };
}

const emptyContext: PromptContext = { headSubject: "Add the thing", snippets: new Map() };

describe("buildPrompt", () => {
  it("headers a commit review with its sha and subject", () => {
    const prompt = buildPrompt(review(), emptyContext, { threadIds: ["t1"] });
    expect(prompt).toContain(`Reviewing commit ${sha} "Add the thing".`);
    expect(prompt).toContain("Do not modify any file.");
    expect(prompt).toContain(`read-only snapshot of commit ${sha}.`);
    expect(prompt).toContain(`The old side of the diff is from commit ${base}`);
  });

  it("headers a compare review with its base and head", () => {
    const target = { kind: "compare" as const, base, head: sha };
    const prompt = buildPrompt(review({ target }), emptyContext, { threadIds: ["t1"] });
    expect(prompt).toContain(`Reviewing changes from ${base} to ${sha}.`);
  });

  it("omits the old-side note when there is no base", () => {
    const prompt = buildPrompt(review({ base: null }), emptyContext, { threadIds: ["t1"] });
    expect(prompt).not.toContain("old side of the diff");
  });

  it("writes a block per thread with its id, anchor, and message history", () => {
    const prompt = buildPrompt(review(), emptyContext, { threadIds: ["t1"] });
    expect(prompt).toContain("Thread t1 — src/a.ts, new line(s) 10-10");
    expect(prompt).toContain("Reviewer: What does this do?");
  });

  it("marks only the threads of the run being started, even with two running runs", () => {
    const r = review({
      threads: [thread({ id: "t1" }), thread({ id: "t2", anchor: { path: "src/b.ts", side: "new", startLine: 2, endLine: 2 } })],
      runs: [runningRun({ id: "r1", threadIds: ["t1"] }), runningRun({ id: "r2", threadIds: ["t2"] })],
    });

    const sectionOf = (prompt: string, id: string) => prompt.split("\n\n").find((s) => s.startsWith(`Thread ${id}`))!;
    const first = buildPrompt(r, emptyContext, r.runs[0]);
    const second = buildPrompt(r, emptyContext, r.runs[1]);

    expect(sectionOf(first, "t1")).toContain("Needs a reply.");
    expect(sectionOf(first, "t2")).not.toContain("Needs a reply.");
    expect(sectionOf(second, "t2")).toContain("Needs a reply.");
    expect(sectionOf(second, "t1")).not.toContain("Needs a reply.");
  });

  it("tells the agent to refer to threads by file and line in the summary, not by id", () => {
    const prompt = buildPrompt(review(), emptyContext, { threadIds: ["t1"] });
    expect(prompt).toContain("In the summary, refer to threads by file and line, never by thread id.");
  });

  it("labels agent messages with the agent and model", () => {
    const r = review({
      threads: [
        thread({
          messages: [
            { id: "m1", author: "reviewer", body: "Why?", createdAt: "d", state: "sent" },
            { id: "m2", author: "agent", body: "Because X.", createdAt: "d", agent: "claude", model: "haiku", runId: "r0", read: false },
          ],
        }),
      ],
    });
    const prompt = buildPrompt(r, emptyContext, { threadIds: ["t1"] });
    expect(prompt).toContain("Agent (claude · haiku): Because X.");
  });

  it("includes a follow-up thread's full history and other threads for context when a different agent/model runs next", () => {
    const followUpThread = thread({
      id: "t1",
      messages: [
        { id: "m1", author: "reviewer", body: "Why this approach?", createdAt: "d", state: "sent" },
        { id: "m2", author: "agent", body: "Because it avoids an N+1.", createdAt: "d", agent: "claude", model: "haiku", runId: "r1", read: true },
        { id: "m3", author: "reviewer", body: "As in my other comment, does this scale?", createdAt: "d", state: "sent" },
      ],
    });
    const otherThread = thread({
      id: "t2",
      anchor: { path: "src/b.ts", side: "new", startLine: 20, endLine: 20 },
      messages: [
        { id: "m4", author: "reviewer", body: "What about here?", createdAt: "d", state: "sent" },
        { id: "m5", author: "agent", body: "Same pattern as src/a.ts.", createdAt: "d", agent: "claude", model: "haiku", runId: "r1", read: true },
      ],
    });
    const r = review({
      threads: [followUpThread, otherThread],
      runs: [runningRun({ agent: "codex", model: "gpt-5.6-luna", threadIds: ["t1"] })],
    });

    const prompt = buildPrompt(r, emptyContext, { threadIds: ["t1"] });
    const sections = prompt.split("\n\n");
    const t1Section = sections.find((s) => s.startsWith("Thread t1"))!;
    const t2Section = sections.find((s) => s.startsWith("Thread t2"))!;

    expect(t1Section).toContain("Reviewer: Why this approach?");
    expect(t1Section).toContain("Agent (claude · haiku): Because it avoids an N+1.");
    expect(t1Section).toContain("Reviewer: As in my other comment, does this scale?");
    expect(t1Section.endsWith("Needs a reply.")).toBe(true);
    expect(t2Section).toContain("Agent (claude · haiku): Same pattern as src/a.ts.");
    expect(t2Section.endsWith("Needs a reply.")).toBe(false);
  });

  it("marks the anchored lines with a leading '>' in the snippet", () => {
    const context: PromptContext = {
      headSubject: "x",
      snippets: new Map([
        [
          "t1",
          [
            { number: 9, text: "before", marked: false },
            { number: 10, text: "the line", marked: true },
            { number: 11, text: "after", marked: false },
          ],
        ],
      ]),
    };
    const prompt = buildPrompt(review(), context, { threadIds: ["t1"] });
    expect(prompt).toContain("> 10: the line");
    expect(prompt).toContain("  9: before");
  });

  it("marks threads that need a reply, and only those in the running run", () => {
    const r = review({
      threads: [thread({ id: "t1" }), thread({ id: "t2" })],
      runs: [runningRun({ threadIds: ["t1"] })],
    });
    const prompt = buildPrompt(r, emptyContext, { threadIds: ["t1"] });
    const sections = prompt.split("\n\n");
    const t1Section = sections.find((s) => s.startsWith("Thread t1"))!;
    const t2Section = sections.find((s) => s.startsWith("Thread t2"))!;
    expect(t1Section.endsWith("Needs a reply.")).toBe(true);
    expect(t2Section.endsWith("Needs a reply.")).toBe(false);
  });

  it("marks resolved threads as for-context-only and never needing a reply", () => {
    const r = review({
      threads: [thread({ id: "t1", resolved: true })],
      runs: [runningRun({ threadIds: ["t1"] })],
    });
    const prompt = buildPrompt(r, emptyContext, { threadIds: ["t1"] });
    const sections = prompt.split("\n\n");
    const t1Section = sections.find((s) => s.startsWith("Thread t1"))!;
    expect(t1Section).toContain("(resolved, for context only)");
    expect(t1Section.endsWith("Needs a reply.")).toBe(false);
  });

  it("puts the answer contract right after the header, before any thread block, and a short reminder at the end", () => {
    const prompt = buildPrompt(review(), emptyContext, { threadIds: ["t1"] });
    const contractIndex = prompt.indexOf('Answer every thread marked "Needs a reply."');
    const threadIndex = prompt.indexOf("Thread t1");
    const reminderIndex = prompt.indexOf("Reminder:");
    expect(contractIndex).toBeGreaterThan(-1);
    expect(contractIndex).toBeLessThan(threadIndex);
    expect(reminderIndex).toBeGreaterThan(threadIndex);
    expect(prompt.trimEnd().endsWith(prompt.slice(reminderIndex).trimEnd())).toBe(true);
  });

  describe("trimming when over budget", () => {
    const longLine = (label: string) => Array.from({ length: 400 }, (_, i) => `${label}-${i}`).join(" ");

    function snippetOf(id: string, lines: number): PromptSnippet {
      return Array.from({ length: lines }, (_, i) => ({ number: i + 1, text: longLine(`${id}-snippet-${i}`), marked: i === 0 }));
    }

    function manyMessages(count: number): ThreadMessage[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `m${i}`,
        author: "reviewer" as const,
        body: `Older message number ${i}. ${longLine(`history-${i}`)}`,
        createdAt: "d",
        state: "sent" as const,
      }));
    }

    it("trims a resolved thread's snippet and history first", () => {
      const needsReplyThread = thread({ id: "t1" });
      const resolvedThread = thread({
        id: "t2",
        resolved: true,
        messages: manyMessages(5),
      });
      const r = review({
        threads: [needsReplyThread, resolvedThread],
        runs: [runningRun({ threadIds: ["t1"] })],
      });
      const context: PromptContext = {
        headSubject: "x",
        snippets: new Map([
          ["t1", snippetOf("t1", 2)],
          ["t2", snippetOf("t2", 200)],
        ]),
      };

      const full = buildPrompt(r, context, { threadIds: ["t1"] }, Number.MAX_SAFE_INTEGER);
      const trimmed = buildPrompt(r, context, { threadIds: ["t1"] }, full.length - 1);

      expect(trimmed).toContain("snippet and message history omitted");
      expect(trimmed).not.toContain("t2-snippet-0");
      expect(trimmed).not.toContain("Older message number 0");
      expect(trimmed).toContain("t1-snippet-0");
      expect(trimmed).toContain("Reviewer: What does this do?");
      expect(trimmed).toContain('Answer every thread marked "Needs a reply."');
      expect(trimmed).toContain("Reminder:");
    });

    it("then trims older messages of threads that do not need a reply", () => {
      const needsReplyThread = thread({ id: "t1" });
      const answeredThread = thread({
        id: "t2",
        messages: [
          ...manyMessages(5),
          { id: "agent-1", author: "agent", body: "Latest agent reply.", createdAt: "d", agent: "claude", model: "haiku", runId: "r0", read: false },
        ],
      });
      const r = review({
        threads: [needsReplyThread, answeredThread],
        runs: [runningRun({ threadIds: ["t1"] })],
      });
      const context: PromptContext = {
        headSubject: "x",
        snippets: new Map([
          ["t1", snippetOf("t1", 2)],
          ["t2", snippetOf("t2", 2)],
        ]),
      };

      const full = buildPrompt(r, context, { threadIds: ["t1"] }, Number.MAX_SAFE_INTEGER);
      const trimmed = buildPrompt(r, context, { threadIds: ["t1"] }, full.length - 1);

      expect(trimmed).toContain("earlier messages omitted");
      expect(trimmed).not.toContain("Older message number 0");
      expect(trimmed).toContain("Latest agent reply.");
      expect(trimmed).toContain("t1-snippet-0");
      expect(trimmed).toContain("Reviewer: What does this do?");
      expect(trimmed).toContain('Answer every thread marked "Needs a reply."');
      expect(trimmed).toContain("Reminder:");
    });

    it("finally drops snippets everywhere, but never the needs-reply thread's messages or the instructions", () => {
      const needsReplyThread = thread({ id: "t1", messages: [{ id: "m1", author: "reviewer", body: "Why this change?", createdAt: "d", state: "sent" }] });
      const r = review({
        threads: [needsReplyThread],
        runs: [runningRun({ threadIds: ["t1"] })],
      });
      const context: PromptContext = {
        headSubject: "x",
        snippets: new Map([["t1", snippetOf("t1", 300)]]),
      };

      const full = buildPrompt(r, context, { threadIds: ["t1"] }, Number.MAX_SAFE_INTEGER);
      const trimmed = buildPrompt(r, context, { threadIds: ["t1"] }, full.length - 1);

      expect(trimmed).toContain("snippet omitted");
      expect(trimmed).not.toContain("t1-snippet-0");
      expect(trimmed).toContain("Reviewer: Why this change?");
      expect(trimmed).toContain('Answer every thread marked "Needs a reply."');
      expect(trimmed).toContain("Reminder:");
    });

    it("never drops the instructions or the needs-reply thread's messages, even at an extreme budget", () => {
      const needsReplyThread = thread({ id: "t1", messages: [{ id: "m1", author: "reviewer", body: "Why this change?", createdAt: "d", state: "sent" }] });
      const r = review({
        threads: [needsReplyThread],
        runs: [runningRun({ threadIds: ["t1"] })],
      });
      const context: PromptContext = { headSubject: "x", snippets: new Map([["t1", snippetOf("t1", 300)]]) };

      const trimmed = buildPrompt(r, context, { threadIds: ["t1"] }, 10);

      expect(trimmed).toContain('Answer every thread marked "Needs a reply."');
      expect(trimmed).toContain("Reminder:");
      expect(trimmed).toContain("Reviewer: Why this change?");
      expect(trimmed).toContain("Needs a reply.");
    });
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "outil-prompt-repo-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  return { dir, git };
}

describe("promptContext", () => {
  it("reads the new side from head and the old side from base, as of each commit", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.ts"), "line1\nold-content\nline3\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "base commit");
    const baseSha = git("rev-parse", "HEAD");

    writeFileSync(join(dir, "a.ts"), "line1\nnew-content\nline3\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "head commit");
    const headSha = git("rev-parse", "HEAD");

    const r: Review = {
      key: `${baseSha}..${headSha}`,
      target: { kind: "compare", base: baseSha, head: headSha },
      base: baseSha,
      head: headSha,
      threads: [
        thread({ id: "t1", anchor: { path: "a.ts", side: "new", startLine: 2, endLine: 2 } }),
        thread({ id: "t2", anchor: { path: "a.ts", side: "old", startLine: 2, endLine: 2 } }),
      ],
      runs: [],
      nextThread: 3,
      revision: 0,
      generation: "g1",
    };

    const context = await promptContext(dir, r, (sha) => getCommit(dir, sha), noRenames);
    const newSnippet = context.snippets.get("t1");
    const oldSnippet = context.snippets.get("t2");
    expect(newSnippet?.some((line) => line.text === "new-content")).toBe(true);
    expect(oldSnippet?.some((line) => line.text === "old-content")).toBe(true);
    expect(newSnippet?.some((line) => line.text === "old-content")).toBe(false);
    expect(oldSnippet?.some((line) => line.text === "new-content")).toBe(false);
  });

  it("captures the head commit's subject", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.ts"), "x");
    git("add", "a.ts");
    git("commit", "-q", "-m", "Add the thing");
    const headSha = git("rev-parse", "HEAD");

    const r: Review = {
      key: headSha,
      target: { kind: "commit", sha: headSha },
      base: null,
      head: headSha,
      threads: [],
      runs: [],
      nextThread: 1,
      revision: 0,
      generation: "g1",
    };

    const context = await promptContext(dir, r, (sha) => getCommit(dir, sha), noRenames);
    expect(context.headSubject).toBe("Add the thing");
  });

  it("uses the old path for a renamed file's old-side snippet", async () => {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "a.ts"), "line1\nold-name-content\nline3\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "base commit");
    const baseSha = git("rev-parse", "HEAD");

    git("mv", "a.ts", "b.ts");
    writeFileSync(join(dir, "b.ts"), "line1\nold-name-content\nline3\nline4\n");
    git("add", "b.ts");
    git("commit", "-q", "-m", "rename a.ts to b.ts");
    const headSha = git("rev-parse", "HEAD");

    const r: Review = {
      key: `${baseSha}..${headSha}`,
      target: { kind: "compare", base: baseSha, head: headSha },
      base: baseSha,
      head: headSha,
      threads: [thread({ id: "t1", anchor: { path: "b.ts", side: "old", startLine: 2, endLine: 2 } })],
      runs: [],
      nextThread: 2,
      revision: 0,
      generation: "g1",
    };

    const context = await promptContext(
      dir,
      r,
      (sha) => getCommit(dir, sha),
      (changeBase, changeHead) => listChanges(dir, changeBase, changeHead),
    );
    const oldSnippet = context.snippets.get("t1");
    expect(oldSnippet?.some((line) => line.text === "old-name-content")).toBe(true);
  });
});
