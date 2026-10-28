---
id: OCT-46
title: Replace id claims with one owner lock per workspace
status: done
priority: high
tags:
  - core
  - architecture
created: 2026-10-28T07:39:15.501Z
order: a2
blocked_by: [OCT-44]
---

## Goal

Only one octodo process writes a workspace at a time, so the per-id claim machinery can go. Decision: `docs/decisions/0003-one-writer-per-workspace.md`. This removes the riskiest part of the core refactor (the fresh, uncached id walk) and most of [[OCT-43]].

## Scope

- An owner lock per workspace that the OS releases when its holder dies, even on SIGKILL. Prototype first: an exclusive transaction with Node's built-in `node:sqlite` (t3code `apps/server/src/serverOwnership.ts`, executor `apps/local/src/db/data-dir-ownership.ts`) against alternatives. Decide where the lock file lives (`<home>` keyed by workspace root, or a dot file in `.octodo/` that scans already ignore).
- The holder assigns ids from its own state. Delete `.octodo/.claim-<ID>`, `.pending-id`, `claimIds`, `nextIdOnDisk` and the fresh id walk (`ids.ts`, parts of `scan.ts` and `workspace.ts`).
- A second process that embeds the engine waits for the lock or reports that another octodo holds it. Reads do not need the lock.
- Hand-made files without an id get one from the holder on first read.
- Leftover cleanup of `.claim-*` files from older versions, as a diagnostic fix or on open.

## Done when

- `ids.test.ts` is rewritten to race two real processes on the lock: exactly one writes, and no id is handed out twice.
- `AGENTS.md`'s id-claim paragraphs describe the lock instead.
- Same checks as the rest of this list.
