---
name: update-task
description: Update an outil task (REV-n) in the Notion Tasks database. Ticks acceptance criteria that have been verified and moves the status. Use when work on a REV task starts, when criteria are verified, or when the task is finished.
---

Tasks data source: `collection://a17e6e68-b10a-4c72-8068-3145ca3d56fc` ([database](https://app.notion.com/p/4688b28ec5d34a5cb3169897d348df83), under the [Diff Review Tool](https://app.notion.com/p/3eaba9d35e29815e9192f2444bb67f7c) page).

1. **Find the task.** Fetch the page URL if you have one. Otherwise query the data source for `"userDefined:ID" = n` (REV-n) to get its `url`, then fetch that URL.
2. **Verify before ticking.** Check each open criterion by running something: the type check, the dev server, a build, or a deliberate breaking change in a scratch copy. Reading code alone is not proof. Leave a criterion open if it is only partly met.
3. **Tick.** Use `notion-update-page` with `update_content`, changing `- [ ] <criterion>` to `- [x] <criterion>`. Keep the criterion text exactly as it is.
4. **Status.** Set `Not started` → `In progress` when work begins. Set `Done` only when every criterion is ticked and the work is committed. Update it with `update_properties` and `{"Status": "..."}`.
5. **Report.** Tell the user which criteria you ticked, the evidence for each, and what is still open.
