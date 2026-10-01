---
name: outil-design
description: Use when designing or reviewing UI for Outil, the local code-review tool — building a new screen or component, checking a mockup against the approved design, or looking up a color, spacing, radius or type token. Covers the status vocabulary (draft/waiting/answered/no reply/resolved), the human-vs-agent visual rule, and the 20 approved primitives (Button, StatusChip, Avatar, etc.). Not for implementing Outil's actual product screens (review, threads, composer) — those aren't designed yet.
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
- **Waiting** — blue, `loading` codicon.
- **Answered** — `comment-discussion` codicon with an unread dot. "New reply" until the reviewer opens it.
- **No reply** — red, `warning` codicon. Agent failed, timed out, or was cancelled; the comment is kept.
- **Resolved** — grey, checkmark, folded into a "Resolved N" row with a `chevron-right`.

Never invent a sixth state or restyle these five. Never rely on color alone — each one also has a distinct icon, border style, or mark.

## Human vs agent (memorize this)

Reviewer: dark square avatar with initials, plain message background. Agent: its logo tile (Claude clay `#D97757` with a white mark, Codex ink; light tile in dark mode), message tinted `--ods-sunken`. Logo and tint change together — never one without the other. The palette is neutral ink; there is no accent color.

## Quick token reference

- Surfaces: `--ods-bg`, `--ods-surface`, `--ods-popover`, `--ods-sunken`
- Borders: `--ods-line`, `--ods-line-2`
- Text: `--ods-fg`, `--ods-fg-2`, `--ods-fg-3`
- Ink: `--ods-ink`, `--ods-on-ink` (primary button, focus ring, checked states); `--ods-popover` for popovers
- Diff: `--ods-add-bg` / `--ods-add-line` / `--ods-add-fg`, `--ods-del-bg` / `--ods-del-line` / `--ods-del-fg`
- Status: `--ods-draft` / `--ods-draft-bg` / `--ods-draft-line`, `--ods-wait` / `--ods-wait-bg`, `--ods-fail` / `--ods-fail-bg`
- Fonts: `--ods-font-ui` (Schibsted Grotesk, everything except code), `--ods-font-mono` (JetBrains Mono, code/paths/SHAs/shortcuts)
- Type scale: `--ods-text-2xs` (11px) to `--ods-text-3xl` (34px)
- Spacing: `--ods-space-1` (2px) to `--ods-space-12` (20px)
- Radius: `--ods-radius-sm` (4px), `md` (6px), `lg` (8px), `xl` (10px), `pill` (999px)

## Icons

Codicons (`@vscode/codicons`, CC-BY-4.0) through the `Icon` primitive: chevron-down/right, arrow-swap, arrow-up/down, layout, check, add, warning, loading, comment-discussion. There are no sun/moon icons; the theme control is a text pill System / Light / Dark.

## The 20 primitives

`Button`, `SegmentedControl`, `Tabs`, `FilterPill` (actions) · `StatusChip`, `Tag`, `FileStatusBadge`, `CountBadge`, `DiffStat` (status) · `Spinner`, `ProgressBar`, `Note` (feedback) · `TextInput`, `TextArea`, `Checkbox`, `Kbd` (inputs) · `Avatar` (people) · `Popover`, `MenuOption` (overlay) · `Icon` (media)
