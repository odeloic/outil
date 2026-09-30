export type RepoInfo = {
  root: string
  // null when the repo has no commits yet
  head: string | null
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
