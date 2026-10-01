import { askAgent } from "./agents/ask.ts";
import { createAgentCache, createModelsCache } from "./agents/cache.ts";
import { detectAgents } from "./agents/detect.ts";
import { listModels } from "./agents/models.ts";
import { promptContext } from "./agents/prompt.ts";
import { getFileDiff } from "./diff.ts";
import { publishActivity, publishingStore, subscribe } from "./events.ts";
import { assertCommits, compareCommits, getCommit, getRepoInfo, listChanges, listCommits, resolveCommit } from "./git.ts";
import { createRoutes } from "./routes.ts";
import {
  addFollowUp,
  assertAnchorInDiff,
  createTargetResolver,
  createThread,
  deleteDraft,
  editDraft,
  markThreadRead,
  resolveThread,
} from "./reviews.ts";
import { createFileStore } from "./reviewFiles.ts";
import { createRunner, type Runner } from "./runs.ts";

const runners = new Set<Runner>();

export function stopAllRunners(): Promise<void> {
  return Promise.all([...runners].map((runner) => runner.stopAll())).then(() => undefined);
}

export function createApp(cwd: string) {
  const boundListChanges = (base: string | null, head: string) => listChanges(cwd, base, head);
  const boundGetCommit = (sha: string) => getCommit(cwd, sha);
  const store = publishingStore(
    createFileStore(
      cwd,
      createTargetResolver({
        assertCommits: (...shas) => assertCommits(cwd, ...shas),
        getCommit: boundGetCommit,
        compareCommits: (base, head) => compareCommits(cwd, base, head),
      }),
    ),
  );
  const agentCache = createAgentCache(() => detectAgents());
  const modelsCache = createModelsCache((agent) => listModels(agent));
  const runner = createRunner({
    store,
    ask: (options) => askAgent({ repoRoot: cwd, ...options }),
    agents: () => agentCache.list(),
    listModels: (agent) => modelsCache.list(agent),
    context: (review) => promptContext(cwd, review, boundGetCommit, boundListChanges),
    onChange: () => {},
    onActivity: (key, runId, text) => publishActivity(key, { runId, text, at: new Date().toISOString() }),
  });
  runners.add(runner);

  return createRoutes({
    repoInfo: () => getRepoInfo(cwd),
    resolveCommit: (ref) => resolveCommit(cwd, ref),
    getCommit: boundGetCommit,
    listChanges: boundListChanges,
    getFileDiff: (request) => getFileDiff(cwd, request),
    listCommits: (query) => listCommits(cwd, query),
    compareCommits: (base, head) => compareCommits(cwd, base, head),
    getReview: (target) => runner.get(target),
    createThread: (target, anchor, body) =>
      store.update(target, async (review) => {
        await assertAnchorInDiff({ listChanges: boundListChanges }, review, anchor.path);
        return createThread(review, anchor, body);
      }),
    editDraft: (target, id, body) => store.update(target, (review) => editDraft(review, id, body)),
    deleteDraft: (target, id) => store.update(target, (review) => deleteDraft(review, id)),
    addFollowUp: (target, id, body) => store.update(target, (review) => addFollowUp(review, id, body)),
    resolveThread: (target, id, resolved) => store.update(target, (review) => resolveThread(review, id, resolved)),
    detectAgents: (refresh) => agentCache.list(refresh),
    listModels: (agent) => listModels(agent),
    send: (target, agent, model) => runner.send(target, agent, model),
    cancelRun: (target, id) => runner.cancel(target, id),
    markThreadRead: (target, id) => store.update(target, (review) => markThreadRead(review, id)),
    subscribeEvents: subscribe,
  });
}
