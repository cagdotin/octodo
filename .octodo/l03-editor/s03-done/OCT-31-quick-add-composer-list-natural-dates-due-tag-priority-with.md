---
id: OCT-31
title: "Quick add composer: /list, natural dates, due:, #tag, !priority with pickers and chips"
priority: none
tags:
  - web
created: 2026-10-26T13:23:40.121Z
updated: 2026-10-26T14:13:56.901Z
order: a1
---

Todoist-style quick add, replacing the plain input in `task-composer.tsx` and `new-task-dialog.tsx`.

- **The model.** `parseQuickAdd` (`apps/web/src/lib/tasks.ts:374`) stays a pure function of the text. It returns `{ title, fields, ranges }`, where the ranges are the spans each token matched. The editor only displays those ranges as chips and adds pickers.
- **Tokens.** `/` searches and picks a list, `#tag`, `!priority`, `due:` opens the existing due picker, and natural dates work anywhere in the text ("tomorrow 5pm").
- **Dates.** chrono-node (13.5K gzip) returns the index and text of the match. It ignores "every", and it read "next fri at 3" as 3 am (measured). Handle `every ...` with our own small grammar that maps to an RRULE string, and leave the rest to chrono. Recurrence itself is OCT-4. The reference implementation is Super Productivity's `short-syntax-date-parser.ts` (MIT).
- **Interaction.** One completion source for `/ # ! @`, using the `@codemirror/autocomplete` `matchBefore` API. Enter submits, pasted newlines are flattened, and clicking a chip turns it back into plain text (as Todoist does).
- **Engine.** CM6 single-line (a transactionFilter that rejects a second line) or an `<input>` with an overlay. The CM6 prototype task decides, based on how it behaves on iPhone.

Depends on: the CM6 prototype task in this list.
