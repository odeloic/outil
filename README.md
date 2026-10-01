# outil

A local code review tool. It opens any commit of a git repository in your
browser as a GitHub-style review: the commit's details, the list of changed
files, and each file's diff with syntax highlighting, side by side or unified.
You can browse the history and compare two commits or branches. Everything runs
on your machine; nothing is uploaded.

## Run it

From inside any git repository (or one of its folders):

```sh
npx @odeloic/review                 # the latest commit
npx @odeloic/review a1b2c3d         # a commit, branch, tag, or HEAD~2
npx @odeloic/review main feature    # everything feature adds since it branched off main
```

The review opens in your browser at `http://127.0.0.1:4747`. If that port is
taken, a free one is used and printed. Press Ctrl+C to stop.

Options:

- `--port <number>`: preferred port (default 4747)
- `--no-open`: print the address without opening the browser
- `-h, --help` and `-v, --version`

The review is only reachable from your own machine. Display choices (split or
unified, wrapping, light or dark) and the files you marked as viewed are kept in
the browser.

## Reviews

Drafts, sent comments, agent replies, and resolved state persist across
reloads and restarts. Each review is stored as its own JSON file under
`.git/outil/reviews/` in the reviewed repository's git directory, keyed by the
commit or comparison it belongs to. Worktrees of the same repository share
this data since it lives in the common git directory. It stays on your
machine, is never part of the repository's history, and never shows up in
`git status`. To delete it, remove the `outil` folder inside `.git` (or
inside the directory `git rev-parse --git-common-dir` prints, for a
worktree).

Live run progress (activity, elapsed time, cancel) is kept in memory per
`outil` process, so a run started from another `outil` instance on the same
repository — for example from a worktree — only shows its result after a
reload, once it has finished and been persisted.

## Requirements

- Node.js 24 or newer
- git
- To ask a coding agent for a review, [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
  or [Codex](https://www.npmjs.com/package/@openai/codex) installed and signed in. Check availability any
  time from the Agents panel in the review's left rail. Your choice of agent and model is
  remembered in the browser (`localStorage`) and restored the next time you open the tool.
  Codex's model list comes from `codex debug models`, which reads your Codex config; runs
  themselves ignore user config (`--ignore-user-config`), so a model from a custom provider
  in your config may be listed but not actually run.

## Develop

```sh
pnpm install
pnpm dev      # the app against this repository, with hot reload
pnpm test
pnpm build    # dist/client (the interface) and dist/server (the command)
```

## Shared agent skills

Maintain skills in `.claude/skills/<skill-name>/SKILL.md`, including YAML
frontmatter with `name` and `description`. Claude Code uses that directory;
Codex and agents that discover `.agents/skills` use the same files through a
relative symlink:

```sh
pnpm agents:sync
```

The command creates or repairs `.agents/skills -> ../.claude/skills` and refuses
to overwrite a real file or directory. Once linked, additions, edits, and removals
are shared automatically; no conversion or repeated sync is needed. Commit the
symlink alongside the skills so fresh checkouts share the same setup.

This is repository-local discovery. Agents with different discovery paths need
their own link or configuration, and distributing skills as an installable plugin
requires a separate package manifest.
