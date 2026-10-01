export type RepoInfo = {
  root: string
  // null when the repo has no commits yet
  head: string | null
  reviewer: string | null
}

export type ResolvedCommit = {
  ref: string
  sha: string
}

export type CommitDetails = {
  sha: string
  parents: string[]
  author: { name: string; email: string }
  date: string
  subject: string
  body: string
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed"

export type FileChange = {
  path: string
  oldPath: string | null
  status: FileChangeStatus
  additions: number
  deletions: number
  binary: boolean
}

export type ChangeSet = {
  base: string | null
  head: string
  files: FileChange[]
  additions: number
  deletions: number
}

export type Comparison = {
  base: CommitDetails
  head: CommitDetails
  mergeBase: string | null
  commitCount: number
}

export type CommitSummary = {
  sha: string
  parents: string[]
  author: { name: string; email: string }
  date: string
  subject: string
}

export type HistoryPage = {
  commits: CommitSummary[]
  hasMore: boolean
}

export type HistoryQuery = {
  skip: number
  limit: number
  message: string
  author: string
}

export type HunkLine = {
  kind: "context" | "add" | "del"
  text: string
}

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: HunkLine[]
}

export type FileDiffRequest = {
  base: string | null
  head: string
  path: string
  oldPath: string | null
  full: boolean
}

export type FileDiff =
  | { kind: "binary" }
  | { kind: "too-large"; bytes: number }
  | { kind: "text"; hunks: Hunk[]; oldText: string | null; newText: string | null }

export type RefErrorCode = "empty-repo" | "unknown" | "ambiguous" | "not-a-commit" | "not-single"

export type ApiError = {
  error: string
  code?: RefErrorCode
}

export type AgentId = "claude" | "codex"

export type AgentStatus = {
  id: AgentId
  name: string
  state: "not-installed" | "signed-out" | "ready"
  fix: string | null
}

export type AgentModel = {
  id: string
  label: string
}

export type LineSide = "old" | "new"

export type ThreadAnchor = {
  path: string
  side: LineSide
  startLine: number
  endLine: number
}

export type ReviewerMessage = {
  id: string
  author: "reviewer"
  body: string
  createdAt: string
  state: "draft" | "sent"
}

export type AgentMessage = {
  id: string
  author: "agent"
  body: string
  createdAt: string
  agent: AgentId
  model: string
  runId: string
  read: boolean
}

export type ThreadMessage = ReviewerMessage | AgentMessage

export type Thread = {
  id: string
  anchor: ThreadAnchor
  messages: ThreadMessage[]
  resolved: boolean
  createdAt: string
}

export type RunState = "running" | "done" | "failed" | "timed-out" | "cancelled" | "interrupted"

export type RunOwner = {
  pid: number
  instance: string
}

export type Run = {
  id: string
  agent: AgentId
  model: string
  state: RunState
  threadIds: string[]
  startedAt: string
  endedAt: string | null
  summary: string | null
  error: string | null
  owner: RunOwner | null
}

export type ReviewTarget = { kind: "commit"; sha: string } | { kind: "compare"; base: string; head: string }

export type Review = {
  key: string
  target: ReviewTarget
  base: string | null
  head: string
  threads: Thread[]
  runs: Run[]
  nextThread: number
  revision: number
  generation: string
}

export type ActivityEvent = {
  runId: string
  seq: number
  text: string
  at: string
}
