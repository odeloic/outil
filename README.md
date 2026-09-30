# outil

Agentic coding review tool.

```
npx @odeloic/review
```

Documentation is still in progress.

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
