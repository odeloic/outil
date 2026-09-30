import { detectAgents } from "./agents/detect.ts";
import { getFileDiff } from "./diff.ts";
import { assertCommits, compareCommits, getCommit, getRepoInfo, listChanges, listCommits, resolveCommit } from "./git.ts";
import { createRoutes } from "./routes.ts";
import { assertAnchorInDiff, createTargetResolver, createThread, deleteDraft, editDraft } from "./reviews.ts";
import { createFileStore } from "./reviewFiles.ts";

export function createApp(cwd: string) {
  const boundListChanges = (base: string | null, head: string) => listChanges(cwd, base, head);
  const store = createFileStore(
    cwd,
    createTargetResolver({
      assertCommits: (...shas) => assertCommits(cwd, ...shas),
      getCommit: (sha) => getCommit(cwd, sha),
      compareCommits: (base, head) => compareCommits(cwd, base, head),
    }),
  );

  return createRoutes({
    repoInfo: () => getRepoInfo(cwd),
    resolveCommit: (ref) => resolveCommit(cwd, ref),
    getCommit: (sha) => getCommit(cwd, sha),
    listChanges: boundListChanges,
    getFileDiff: (request) => getFileDiff(cwd, request),
    listCommits: (query) => listCommits(cwd, query),
    compareCommits: (base, head) => compareCommits(cwd, base, head),
    getReview: (target) => store.get(target),
    createThread: (target, anchor, body) =>
      store.update(target, async (review) => {
        await assertAnchorInDiff({ listChanges: boundListChanges }, review, anchor.path);
        return createThread(review, anchor, body);
      }),
    editDraft: (target, id, body) => store.update(target, (review) => editDraft(review, id, body)),
    deleteDraft: (target, id) => store.update(target, (review) => deleteDraft(review, id)),
    detectAgents: () => detectAgents(),
  });
}
