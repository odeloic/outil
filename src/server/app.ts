import { getRepoInfo } from "./git.ts";
import { createRoutes } from "./routes.ts";

export default createRoutes({ repoInfo: () => getRepoInfo(process.cwd()) });
