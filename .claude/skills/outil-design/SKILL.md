---
name: outil-design
description: Use when designing or reviewing UI for Outil, the local code-review tool — building a new screen or component, checking a mockup against the approved design, or looking up a color, spacing, radius or type token. Covers the status vocabulary (draft/waiting/answered/no reply/resolved), the human-vs-agent visual rule, and the 19 approved primitives (Button, StatusChip, Avatar, etc.). Not for implementing Outil's actual product screens (review, threads, composer) — those aren't designed yet.
---

# Outil design system

Outil is a local code review tool: a developer comments on diff lines of a commit, sends drafts to a coding agent, and the agent replies in the same threads. This skill is the design system for it — tokens and primitives, approved and ready to build with. No product screens exist yet; don't invent one.

## Where things live

All of it is in this repo, under `src/web/design-system/`:

- `tokens/color.css`, `tokens/type.css`, `tokens/spacing.css` — the CSS custom properties, light and dark.
- `styles.css` — imports all tokens plus `components/components.css`. Link this one file to get everything.
- `components/<group>/<Name>.tsx` — each primitive's implementation and props. Groups: `actions`, `status`, `feedback`, `inputs`, `people`, `overlay`.
- `index.ts` — barrel export of every component and its prop types.
- `references/design-guide.md` — the full design guide: why each token and component decision was made, and which primitive fits which situation. Read it for any non-trivial question.

A browsable version of this same design system (live component previews and a compiled bundle) also exists outside the repo, for the Claude Design "Outil Design System" project. The two are derived from one source; this repo's `.tsx` files are the one to edit when changing behavior.

## How to use the components

```tsx
import { Button, StatusChip, Avatar } from '../design-system'

<Button variant="primary">Send 3 drafts</Button>
<StatusChip status="answered" unread />
<Avatar kind="agent" />
```

Use only `ods-*` classes and the CSS custom properties from `tokens/*.css` — never a raw hex value or an ad hoc pixel size. If a screen needs something not in the list below, that's a sign a new primitive is needed, not a one-off style.

## The status vocabulary (memorize this)

One vocabulary, five states, reused everywhere a thread's state shows up:

- **Draft** — dashed amber border, editable until sent.
- **Waiting** — blue, spinner icon.
- **Answered** — violet, diamond icon. "New reply" until the reviewer opens it.
- **No reply** — red, "!" mark. Agent failed, timed out, or was cancelled; the comment is kept.
- **Resolved** — grey, checkmark, folded to one row.

Never invent a sixth state or restyle these five. Never rely on color alone — each one also has a distinct icon, border style, or mark.

## Human vs agent (memorize this)

Reviewer: dark square avatar with initials, plain message background. Agent: violet diamond avatar (no initials), message tinted `--ods-agent-bg` with `--ods-agent`-colored text. Shape and tint both change together — never one without the other.

## Quick token reference

- Surfaces: `--ods-bg`, `--ods-surface`, `--ods-sunken`
- Borders: `--ods-line`, `--ods-line-2`
- Text: `--ods-fg`, `--ods-fg-2`, `--ods-fg-3`
- Agent accent: `--ods-agent`, `--ods-agent-bg`, `--ods-agent-line`, `--ods-on-agent`
- Diff: `--ods-add-bg` / `--ods-add-line` / `--ods-add-fg`, `--ods-del-bg` / `--ods-del-line` / `--ods-del-fg`
- Status: `--ods-draft` / `--ods-draft-bg` / `--ods-draft-line`, `--ods-wait` / `--ods-wait-bg`, `--ods-fail` / `--ods-fail-bg`
- Fonts: `--ods-font-ui` (Schibsted Grotesk, everything except code), `--ods-font-mono` (JetBrains Mono, code/paths/SHAs/shortcuts)
- Type scale: `--ods-text-2xs` (11px) to `--ods-text-3xl` (34px)
- Spacing: `--ods-space-1` (2px) to `--ods-space-12` (20px)
- Radius: `--ods-radius-sm` (4px), `md` (6px), `lg` (8px), `xl` (10px), `pill` (999px)

## The 19 primitives

`Button`, `SegmentedControl`, `Tabs`, `FilterPill` (actions) · `StatusChip`, `Tag`, `FileStatusBadge`, `CountBadge`, `DiffStat` (status) · `Spinner`, `ProgressBar`, `Note` (feedback) · `TextInput`, `TextArea`, `Checkbox`, `Kbd` (inputs) · `Avatar` (people) · `Popover`, `MenuOption` (overlay)
