---
name: ship-it
description: Release outil. Checks the commits pending on main against origin/main, verifies them, bumps the version, tags, pushes main and the tag, then watches the Release workflow that publishes to npm. Use when the user asks to ship, release, tag, or publish outil.
---

Pushing a `v*.*.*` tag runs `.github/workflows/release.yml`, which publishes to npm. A published version cannot be reused, so confirm the version with the user before pushing.

1. **Preconditions.** Run `git fetch origin`. Stop and report if the branch is not `main`, the tree is not clean, or `main` is behind `origin/main` (`git log --oneline main..origin/main` is not empty). If a feature branch is still unmerged, ask the user whether to fast-forward it into `main` first (`git merge --ff-only <branch>`, then `git branch -d <branch>`).
2. **Pending changes.** List `git log --oneline origin/main..main`. If it is empty, there is nothing to ship; stop.
3. **Version.** Read the current version from `package.json` and the latest tag (`git tag --sort=-creatordate | head -1`). Propose the next one from the pending commit types: any `feat` means a minor bump, otherwise a patch bump. A breaking change (`!` after the type) means asking the user. Show the pending commits and the proposed version, then wait for confirmation.
4. **Verify.** Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. Stop on any failure.
5. **Release commit and tag.** Set `"version"` in `package.json`, commit it alone as `chore(backend): release X.Y.Z`, then create a lightweight tag `vX.Y.Z` (`git tag vX.Y.Z`, not annotated, matching earlier tags).
6. **Push.** Run `git push --atomic origin main vX.Y.Z`, so `main` and the tag land together or not at all.
7. **Watch.** Find the run with `gh run list --workflow Release --limit 3` (the one whose branch column is `vX.Y.Z`), then `gh run watch <id> --exit-status`. If it fails, show `gh run view <id> --log-failed`. Do not delete or move the tag without asking.
8. **Report.** Give the version, the commits it ships, the workflow result and its URL, and any warnings from the run's annotations.
