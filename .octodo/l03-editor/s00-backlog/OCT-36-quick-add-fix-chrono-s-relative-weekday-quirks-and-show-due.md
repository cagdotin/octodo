---
id: OCT-36
title: "Quick add: fix chrono's relative weekday quirks and show due chips as words"
priority: none
tags:
  - web
created: 2026-10-26T14:14:02.845Z
updated: 2026-10-26T14:14:02.845Z
order: a4
---

Problems found while building OCT-31:

- chrono-node reads "next fri" as the Friday of the week after next.
- "monday" typed on a Monday resolves to today. Todoist resolves it to the next Monday.
- The `due:` chip shows the raw ISO date (`due:2026-10-27`) instead of "Tomorrow".

Add cases to `quick-add.test.ts`, at a fixed date, for each one.
