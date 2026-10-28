---
id: OCT-47
title: One reader of the folder grammar; the scan only reads (storage/tree.ts)
status: todo
priority: medium
tags:
  - core
  - architecture
created: 2026-10-28T07:39:20.653Z
order: a3
blocked_by: [OCT-45, OCT-46]
---

## Goal

Four walks each implement the folder grammar: `scan.ts` `takeIdsUnder`, `ids.ts` `idsOnDisk`/`nextIdOnDisk`, `fixes.ts` `taskFoldersUnder` and `workspace.ts` `MARKERS`. The "dot names are bookkeeping" rule is repeated in four files. Replace them with one reader.

## Scope

- `storage/tree.ts` reads a generic tree: each folder with its marker (`task.md`, `list.md` or none), the marker's text, attachments and child folders. It knows the grammar, not what a task is; `tasks/` and `lists/` parse the marker texts.
- A global cap on open files during the walk.
- The scan becomes read-only. Today `scan.ts` (~674-727) claims and writes ids, then rescans twice without the cache, behind an `Effect<Scan, never>` type. Id adoption moves to the workspace under the owner lock, and the reread goes through the cache.
- The incremental cache (`scan-cache.ts`) becomes internal to `storage/`.

## Done when

- `scan-cache.test.ts`'s equivalence test (incremental snapshot equals a fresh full scan after 20+ steps) passes unchanged.
- No module outside `storage/` lists a folder.
- Same checks as the rest of this list.
