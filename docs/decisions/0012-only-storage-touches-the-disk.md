# 0012. Only storage touches the disk, and writes go through `Files`

- Status: accepted
- Date: 2026-10-28

## Context

The safety rules for `.octodo/` (atomic writes, new folders built under a dot name, no `mkdir -p`
of a container, every write under the owner lock, every changed path told to the cache, new ids
only from the lock holder) were conventions. `workspace.ts`, `fixes.ts`, `scan.ts` and
`workspaces.ts` each held `FileSystem`, so any of them could break a rule without a test noticing:
`initWorkspace` wrote `config.json` and `.gitignore` outside the owner lock, and the cache learnt
of a write only because the workspace wrapped `FileSystem` in a reporting copy.

## Decision

- Only `packages/engine/src/storage/` imports `FileSystem` or `node:fs`. A lint rule
  (`no-restricted-imports` in `.oxlintrc.json`) fails any other module in `packages/engine/src` that
  does.
- `makeStorage(root)` returns a `Storage`, passed as a plain argument rather than an Effect
  service. Reads (`read`, `exists`, `staysInside`) need no lock. `read` returns
  `{ config, tree }` through the cache, and an unchanged file keeps its text object, which the
  scan's parse cache is keyed by.
- `storage.write((files, ids) => ...)` is the only way to change a file. It holds the owner lock,
  and its callback is an `Effect` with no requirements, so it cannot reach `FileSystem`. `Files`
  offers only whole-entry operations: `writeFile` (temporary sibling, then a rename),
  `createFile` and `createFolder` (never replacing; a taken name gets `-2`), `ensureFolder` (one
  level, in a folder that exists), `moveFolder`, `renameFolder`, `remove` and `editConfig`. Each
  one tells the cache which paths it touched as it finishes, before the watcher publishes a change.
- A task id that a write puts into frontmatter has the type `AssignedId`. Only `ids.next`, handed
  to a write's callback, makes one, so an id that did not come from the lock holder does not
  typecheck as one (`patchFrontmatter`, `newTaskFile`).
- `initWorkspace` creates the folder it is asked to make a workspace (the one `mkdir -p`) and then
  writes `config.json` through a write, so the owner lock covers it too.
- `<home>/workspaces.json` and the folder picker's listing are not in a workspace; they live in
  `storage/home.ts` so that `workspaces.ts` holds no `FileSystem` either.

## Consequences

- `scan.ts` is a pure function from a storage read to a snapshot.
- A new write operation cannot skip the lock, the atomic write or the cache report without
  changing `storage/`, which is where a reviewer looks for that.
- `octo init` creates `.octodo/.owner-lock` at once instead of at the first write.
- Domain code never opens a file: a write edits the text the scan read (`fileText` in `scan.ts`),
  which under the owner lock and the cache is what is on disk (OCT-50). Only an outside edit since
  the scan differs, which [0001](0001-octodo-is-the-only-writer.md) puts outside the contract.
