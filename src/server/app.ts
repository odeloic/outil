import { getFileDiff } from "./diff.ts";
import { getCommit, getRepoInfo, listChanges, listCommits, resolveCommit } from "./git.ts";
import { createRoutes } from "./routes.ts";

export default createRoutes({
  repoInfo: () => getRepoInfo(process.cwd()),
  resolveCommit: (ref) => resolveCommit(process.cwd(), ref),
  getCommit: (sha) => getCommit(process.cwd(), sha),
  listChanges: (base, head) => listChanges(process.cwd(), base, head),
  getFileDiff: (request) => getFileDiff(process.cwd(), request),
  listCommits: (query) => listCommits(process.cwd(), query),
});
