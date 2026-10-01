# Outil design guide

Outil is a local code review tool: a developer comments on diff lines of a commit, sends the drafts to a coding agent (Claude Code or Codex), and the agent replies in the same threads. This is the reasoning behind the tokens and primitives in `src/web/design-system/` — why each decision was made, not just what the values are.

## The status vocabulary

Every comment thread is in exactly one of five states, and the whole product uses one chip for each, everywhere the state appears (the header, the file rail, a thread's own header):

| State | Meaning | How it reads without color |
|---|---|---|
| **Draft** | Written, not sent yet. Editable and deletable. | Dashed border |
| **Waiting** | Sent, the agent hasn't replied. | `loading` icon |
| **Answered** | The agent replied. "New reply" until the reviewer opens it. | `comment-discussion` icon |
| **No reply** | The agent failed, timed out, or was cancelled. The comment is kept. | `warning` icon, red |
| **Resolved** | The reviewer closed the thread. Folds to one row. | Checkmark, grey |

See `StatusChip` in `src/web/design-system/components/status/StatusChip.tsx`.

## Human vs agent

Two rules make the distinction survive without color:

- **Shape.** The reviewer's avatar is a dark square with initials (`Avatar`). The agent's is the generic agent mark (the `agent` codicon on a `--ods-surface` tile with a 1px `--ods-line` ring, `AgentLogo`), identical for every agent and always paired with the agent's name; no vendor logos ship.
- **Tint.** An agent's message, or its summary, sits on `--ods-sunken` with `--ods-line` and `--ods-fg` text. A reviewer's message is plain.

## Additions and removals

Diff colors never carry the meaning alone: an added line always shows a leading `+`, a removed line a leading `−` (minus sign, not a hyphen), in addition to the `--ods-add-*` / `--ods-del-*` background and text tokens. `DiffStat` renders the same pair as a compact `+n −n` summary.

## Color and surfaces

Three background levels (`--ods-bg` page, `--ods-surface` cards and panels, `--ods-sunken` hover states and wells), two border weights (`--ods-line`, `--ods-line-2`), three text weights (`--ods-fg`, `--ods-fg-2`, `--ods-fg-3`). Everything is a CSS custom property, defined once in `tokens/color.css` for light and redefined for dark, both under `@media (prefers-color-scheme: dark)` and under an explicit `[data-theme="dark"]` override (and a `[data-theme="light"]` escape hatch for a user who wants light on a dark system).

## Type

Two font stacks: `--ods-font-ui` (Schibsted Grotesk) for everything except code, `--ods-font-mono` (JetBrains Mono) for code, file paths, commit SHAs, keyboard shortcuts and IDs. An eight-step size scale, `--ods-text-2xs` (11px) through `--ods-text-3xl` (34px), and four weights.

## Spacing and radius

A twelve-step spacing scale (`--ods-space-1` at 2px through `--ods-space-12` at 20px) and a five-step radius scale (`--ods-radius-sm` 4px, `md` 6px, `lg` 8px, `xl` 10px, `pill` 999px), both taken from the values the approved design actually uses rather than a theoretical scale.

## When to use which component

- **Button** — primary for the one commit-worthy action per view (e.g. sending drafts), default for ordinary actions, ghost for low-emphasis actions inside toolbars and popovers.
- **SegmentedControl** — a small, exclusive 2–3 option toggle for a whole view (layout, appearance). Not for more options — use Tabs.
- **Tabs** — switching between a small number of full-panel views (e.g. Files / Threads / History), each with an optional count.
- **StatusChip** — the five-state thread vocabulary above, always the same chip wherever a thread's state shows.
- **Tag** — a small neutral fact label (e.g. "Merge"), not interactive.
- **FileStatusBadge** — a file's change kind: A / M / D / R, with D shown struck through.
- **CountBadge** — a row's count; neutral for an ordinary count, `attention` when it needs the reviewer (e.g. unread replies).
- **DiffStat** — the `+added −removed` pair next to a file or commit summary.
- **Spinner** — a tiny inline loading indicator, sized for a chip or button.
- **ProgressBar** — a labeled determinate progress bar for a known total (e.g. "212 of 340 files viewed").
- **Note** — a bordered banner: default neutral, hint (dashed) for a suggestion or empty state, failure for an error needing attention.
- **TextInput** / **TextArea** — single-line and multi-line fields.
- **Checkbox** — a labeled checkbox (e.g. marking a file viewed).
- **Kbd** — a keyboard shortcut key cap, for hints or a shortcut reference table.
- **Avatar** — see "Human vs agent" above.
- **MenuOption** — one selectable row in a menu (e.g. a branch or commit in the Base/Head range menu).

## Out of scope, on purpose

Threads, composer, diff view, file rail, header and history are product components built from these primitives in `src/web`, not primitives themselves.
