---
id: OCT-49
title: "Storage owns the disk: makeStorage and safe Files operations"
status: todo
priority: medium
tags:
  - core
  - architecture
created: 2026-10-28T07:39:30.753Z
order: a5
blocked_by: [OCT-47]
---

## Goal

Make the safety rules structural instead of conventional. Only `storage/` holds `FileSystem`.

## Scope

- `makeStorage(id, root)` returns `read`, `write`, `changes` and id assignment. Storage is passed as a plain argument (`createTask(storage, input)`), not as an Effect service.
- Fold in what OCT-47 left in `storage/`: `makeTreeReader`, `readConfig`, `reportingChanges` and the watcher. `storage.read` returns `{ config, tree }`, and must keep handing back the same text object for an unchanged file (the scan's parse cache is a `WeakMap` keyed by it; a new object reparses every task).
- `makeStorage` owns the owner lock (`storage/owner-lock.ts`, OCT-46): `storage.write` runs inside `hold`, so no write can skip it. That includes `initWorkspace`'s `config.json` and `.gitignore` writes, which run outside the lock today.
- `storage.write(files => ...)` takes `(files: Files) => Effect<A, E, never>`. `Files` exposes only safe operations: atomic `writeFile`, `createFolder` (built under a dot name, renamed in), `moveFolder`, `renameFolder`, `remove`. A domain module reaching for `FileSystem` fails the typecheck.
- Brand ids so only the owner-lock holder's assigner produces an id that can be written into frontmatter.
- Writes report their touched paths so the cache forgets them before the change is published.
- `initWorkspace` may create the folder it is asked to make a workspace (AGENTS.md); every other create goes through `Files`, including the attachment subfolder create.
- `files.ts` (with `tempName`, `isLeftover`) becomes `storage/files.ts`; record it in `docs/architecture.md`.
- `workspaces.ts` `browse` lists the user's own folders for the folder picker: give it a storage-side home too, or document it as the one exception.

## Done when

- `grep FileSystem packages/core/src` matches only `storage/` (or the documented exception).
- Same checks as the rest of this list.
