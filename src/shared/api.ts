export type RepoInfo = {
  root: string
  // null when the repo has no commits yet
  head: string | null
}

export type ResolvedCommit = {
  ref: string
  sha: string
}

export type RefErrorCode = "empty-repo" | "unknown" | "ambiguous" | "not-a-commit" | "not-single"

export type ApiError = {
  error: string
  code?: RefErrorCode
}
