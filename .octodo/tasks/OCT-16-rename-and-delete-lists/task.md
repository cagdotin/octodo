---
id: OCT-16
title: Rename and delete lists
created: 2026-10-25T18:04:32.639Z
order: aD
status: backlog
---

Lists can be created and moved, but not renamed or deleted, from the app, the CLI or MCP. List kinds were dropped on 2026-10-26, so the old "expose listKinds labels" part is gone.

## Scope

- Rename: changes `name` in `list.md`, and renames the folder to the new slug, which changes the list id (`garden/seeds`) of it and its sublists. Covers [[OCT-15]] if that is not already done.
- Delete: only an empty list, or ask what happens to its tasks (move them to the parent list). Never delete tasks silently.
- Build both as catalog operations ([[OCT-52]]) so they appear on every surface at once. Wait for the catalog rather than hand-writing them three times.
