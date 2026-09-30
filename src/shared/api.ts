export type RepoInfo = {
  root: string
  // null when the repo has no commits yet
  head: string | null
}

export type ApiError = {
  error: string
}
