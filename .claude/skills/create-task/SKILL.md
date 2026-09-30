---
name: create-task
description: Create a new outil task (REV-n) in the Notion Tasks database. Each task has a goal and testable acceptance criteria. Use when the user asks to add, file, plan, or split out a task for outil.
---

Tasks data source: `collection://a17e6e68-b10a-4c72-8068-3145ca3d56fc` ([database](https://app.notion.com/p/4688b28ec5d34a5cb3169897d348df83), under the [Diff Review Tool](https://app.notion.com/p/3eaba9d35e29815e9192f2444bb67f7c) page).

1. **Read the schema.** Fetch the data source to get the current `Milestone` options.
2. **Check for duplicates.** Query existing tasks by title and milestone. If there is a close match, point to it instead of creating a new task.
3. **Draft the properties.**
   - `Task`: the outcome, stated in plain words (e.g. "App runs end to end in development").
   - `Milestone`: one of the existing options. Ask the user if it is unclear.
   - `Order`: one more than the current highest `Order` in that milestone.
   - `Status`: `Not started`.
   - `ID` is assigned automatically.
4. **Draft the body** in exactly this shape:
   ```
   ## Goal
   <One or two sentences: what the user can see or do afterwards, and why it matters.>
   ## Acceptance criteria
   - [ ] <an observable outcome someone can check>
   ```
   Criteria describe behavior, not how it is built. Each one must be something `update-task` can verify.
5. **Confirm, then create.** Show the draft to the user. After they approve, call `notion-create-pages` with parent `{"type": "data_source_id", "data_source_id": "a17e6e68-b10a-4c72-8068-3145ca3d56fc"}`. Return the REV-n ID and the URL.
