import { getFileDiff } from "./diff.ts";
import { compareCommits, getCommit, getRepoInfo, listChanges, listCommits, resolveCommit } from "./git.ts";
import { createRoutes } from "./routes.ts";

export function createApp(cwd: string) {
  return createRoutes({
    repoInfo: () => getRepoInfo(cwd),
    resolveCommit: (ref) => resolveCommit(cwd, ref),
    getCommit: (sha) => getCommit(cwd, sha),
    listChanges: (base, head) => listChanges(cwd, base, head),
    getFileDiff: (request) => getFileDiff(cwd, request),
    listCommits: (query) => listCommits(cwd, query),
    compareCommits: (base, head) => compareCommits(cwd, base, head),
  });
}
