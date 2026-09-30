import { getCommit, getRepoInfo, resolveCommit } from "./git.ts";
import { createRoutes } from "./routes.ts";

export default createRoutes({
  repoInfo: () => getRepoInfo(process.cwd()),
  resolveCommit: (ref) => resolveCommit(process.cwd(), ref),
  getCommit: (sha) => getCommit(process.cwd(), sha),
});
