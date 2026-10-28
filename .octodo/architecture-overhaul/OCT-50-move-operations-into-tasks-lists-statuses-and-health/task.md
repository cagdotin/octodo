---
id: OCT-50
title: Move operations into tasks/, lists/, statuses/ and health/
status: done
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

## From OCT-49

- The storage API (decision 0012): `makeStorage(root, { watch, lockWait })` returns `{ root, tasksDir, read, version, forget, readText, exists, staysInside, write, changes }`. `scanWorkspace(id, root, read)` is already a pure function. Domain functions take `storage` and, inside `storage.write((files, ids) => ...)`, `files` and `ids`.
- "Never open a file": domain code still calls `storage.readText` before it rewrites a file (update, move, delete's link cleanup, `ensureOrdered`, `giveIds`, every fix). Take the text from the scan instead (`taskTexts` is already there for served tasks; duplicates, loose markdown and `list.md` need a path-to-text lookup over the tree) and drop `readText` from `Storage`. Under the owner lock and the cache this is the same text; only an outside edit since the scan differs, which 0001 puts outside the contract.
- `storage.exists` serves `createList`'s and `moveList`'s "already a folder" checks and the attachment subtask check. Both could come from the tree's folder names if the tree kept non-markdown entry names; otherwise keep `exists`.
- The in-process `Semaphore` in `workspace.ts` guards the kept scan, not the disk; it stays with whatever holds the scan memo.
- `giveIds` runs through `storage.write`, so without a watcher it forgets the whole cache afterwards (it did not before). Output is the same; a CLI read of hand-made files rescans once in full.

## Done when

- Domain folders never list a folder or open a file.
- A test pins the reorder behaviour above.
- Same checks as the rest of this list, with the workspace, ids and health tests unchanged.

## Outcome

- `workspace.ts` is 149 lines: the `Workspace` interface with its doc comments (about 65), `initWorkspace`, and one line per method mapping it to `(state, input)` functions in `tasks/`, `lists/`, `statuses/` and `health/`. The kept scan, the in-process semaphore and `giveIds` live in `state.ts`.
- The snapshot is still built by `scan.ts`, not `workspace.ts`: it is one walk of the tree, and splitting it across domain folders would pass one accumulator around. It takes its ordering from `place.ts` and its shown statuses from `statuses/statuses.ts`.
- `place.ts` is pure (destination, orderBetween, renumbered, comparators); the Effect half (`containerDir`, `orderedTasks`, `orderedLists`, writing renumbered keys) is `siblings.ts`, so OCT-51 moves `place.ts` to the contract as is.
- Writes take file text from the scan (`markdownTexts` in `storage/tree.ts`, `fileText` in `scan.ts`); `Storage.readText` is gone. `exists` and `staysInside` stay: they are stats, and the tree does not keep non-markdown names (and on macOS `exists` is case-insensitive, which a name list is not).
- The breadth-first `waiting` queue stays: it also decides which of two folders with one id is the task, so depth-first would change which one `fresh-id` renumbers.
- Statuses: reorder takes the order of every status shown and writes only configured ones; recorded in 0008, pinned by `test/statuses.test.ts`.
- Pin: a CLI and HTTP scenario (`pin50.sh`) on the commit before and after gives identical files apart from `waiting` no longer joining `config.json` on reorder. Bench at 5,000 tasks, alternating with the base commit: no median moved beyond the run-to-run range.
