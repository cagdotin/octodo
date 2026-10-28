---
id: OCT-48
title: Remove handling that exists only for outside writers
status: done
priority: medium
tags:
  - core
  - architecture
created: 2026-10-28T07:39:25.856Z
order: a4
blocked_by: [OCT-47]
---

## Goal

Decision `docs/decisions/0001-octodo-is-the-only-writer.md`: octodo's clients are the only supported writers. Delete code that reconciles outside edits, and keep strict reads and diagnostics.

## Scope

- Inventory first: list every branch in `scan.ts`, `fixes.ts`, `diagnostics.ts`, `files.ts` and `workspace.ts` that exists for sync tools or hand edits. Classify each as "validate and report" (keep) or "reconcile" (delete).
- Known candidates: picking between several task folders with one id (the sync-copy name `HM-3-paint 2`, then the name matching id and title, then the first read) becomes a plain duplicate-id diagnostic; reads that re-read a folder whose marker is a link anew each scan (commit 9fa6f03).
- From OCT-46: the retry in `writeFresh` when a path is gone (it guarded against another octodo process moving folders, which the owner lock now prevents), and the handling of sync-tool copies of temporary names (`.new-<uuid> 2`) in `files.ts`.
- Each `PROBLEMS` row stays a validator. Fixes that only exist to merge outside edits go.
- Update `AGENTS.md` where it describes removed rules.

## Done when

- The inventory and its classification are in the commit message or a short note under `docs/research/`.
- Tests that pinned deleted behavior are deleted or turned into diagnostic tests; every other test passes unchanged.
- Same checks as the rest of this list.

## Outcome

- Inventory: `docs/research/2026-10-outside-writer-inventory.md` (16 removed, 15 kept).
- Removed: `writeFresh`, sync copies of temp names in `isLeftover`, the `conflict-copy` kind and `keep-copy` fix, the ranking of folders with one id, `sameTree`, `conflictCopyOf`, and reading `task.md`/`list.md` through a link (now a `symlink` diagnostic; the folder is not read).
- Kept: ids in files the scan does not read still count as on disk, so `drop-unknown-links` never drops a link to an unreadable task and a new id never collides with a broken file.
- Writes at 5,000 tasks got about 50 ms faster (`docs/research/perf-baseline.md`, "After OCT-48").
