---
id: OCT-28
title: "blocked_by: blocking state, a ready filter and a Ready view"
priority: none
tags:
  - core
  - mcp
  - web
created: 2026-10-26T13:03:40.323Z
updated: 2026-10-26T13:03:40.323Z
order: a2
---

Dependencies built on task links (OCT-27). Only the waiting task stores the edge:

```yaml
blocked_by: ["[[OCT-3-paint-bedroom]]", "[[OCT-7-buy-primer]]"]
```

- A task is blocked while any linked task is outside the `completed` and `canceled` categories, or the link points at no task (fail closed). This is computed when tasks are read and never stored.
- "Blocks" is the reverse, computed the same way.
- MCP: `update_task` takes `blocked_by` as ids and writes the links itself. `get_task` returns blocked_by and blocks with titles and statuses. `list_tasks` takes a `ready` filter: open, and not blocked.
- CLI: `octo list --ready`, plus a way to set and clear blocked_by.
- Web: a lock icon on blocked rows and cards, "Blocked by" and "Blocks" sections in task detail with a task picker, and a Ready smart view next to the existing `@` views.
- A blocked task can still be moved to a started status. The lock shows the state, and nothing refuses the move.
- Out of scope for v1: cycle detection (a cycle just keeps both tasks blocked) and showing the graph more than one level deep.

Depends on: OCT-27.
