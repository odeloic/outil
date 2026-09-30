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

export type RefErrorCode = "empty-repo" | "unknown" | "ambiguous" | "not-a-commit" | "not-single"

export type ApiError = {
  error: string
  code?: RefErrorCode
}
