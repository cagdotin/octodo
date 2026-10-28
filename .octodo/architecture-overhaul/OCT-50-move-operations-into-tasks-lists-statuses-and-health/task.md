---
id: OCT-50
title: Move operations into tasks/, lists/, statuses/ and health/
status: todo
priority: medium
tags:
  - core
  - architecture
created: 2026-10-28T07:39:36.497Z
order: a6
blocked_by: [OCT-48, OCT-49]
---

## Goal

`workspace.ts` holds every operation plus the helpers in the `makeWorkspace` closure. Move the operations into domain folders so `workspace.ts` is wiring only (about 60-100 lines).

## Scope

- `tasks/`: create, update, move, delete; `task-file.ts` (parse and write `task.md`, from `markdown.ts`); `links.ts`; `attachments.ts`.
- `lists/`: create, move; `list-file.ts`.
- `statuses/`: reorder.
- `health/`: fix, fixAll; `problems.ts` (the `PROBLEMS` table); `fixes.ts`.
- `scan.ts` is, after OCT-47, only the parsing step over `storage`'s tree; `tasks/`, `lists/` and `health/` take it over.
- The `Problem` type (storage imports it from `diagnostics.ts` since OCT-47) moves to the shared domain types, so `storage/` never depends on `health/`.
- Placement and ordering helpers (`destination`, `containerDir`, `orderedTasks`, `ensureOrdered`, `orderBetween`) go in a small `place.ts`: they need task parents and `order`, which storage must not know.
- `workspace.ts` builds the snapshot (duplicate ids, links, `blocked`, `mentionedIn`, subtask nesting, cross-domain diagnostics) and maps `Workspace` methods to domain functions.
- Duplicate ids since OCT-48: the first task folder read is the task, every other one is `duplicate-id`. The scan's one `waiting` queue only keeps diagnostics in breadth-first order (pinned by `scan.test.ts`); serving depth-first is simpler if that order is allowed to change.
- Fix the wrong comment at `layout.ts` ~200 ("A new kind is one entry here plus its two `Task` fields"; it touches about 10 files). Link kinds stay non-generic.
- Decide, in `statuses/`: the snapshot's `statuses` include made-up entries for task statuses missing from `config.json` (e.g. `in-review` as unstarted), and `reorderStatuses` writes the whole list, so reordering silently adds them to the config. That contradicts the health rule that an unknown status is added only when asked (found in OCT-45). Reorder should write only configured statuses, or refuse while unknown ones exist.

## Done when

- Domain folders never list a folder or open a file.
- A test pins the reorder behaviour above.
- Same checks as the rest of this list, with the workspace, ids and health tests unchanged.
