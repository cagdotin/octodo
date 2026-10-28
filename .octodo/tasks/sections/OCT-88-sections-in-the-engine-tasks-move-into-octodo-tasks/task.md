---
id: OCT-88
title: "Sections in the engine: tasks move into .octodo/tasks/"
status: done
priority: high
tags:
  - architecture
  - core
  - plugins
created: 2026-10-28T15:52:03.493Z
order: a0
---

Phase 1 of [0027](docs/decisions/0027-plugins-add-sections-tasks-is-the-built-in-one.md).

## Goal

The engine reads a workspace as sections. Tasks is the built-in section in `.octodo/tasks/`, and that folder is the root list. A plugin can declare a section (its id, folder, marker file, and whether it has lists and sub-entries) as well as kinds, and a kind names its section, tasks by default.

## Scope

- `PluginShared` and `checkPlugins` learn sections. Two plugins cannot claim one section id, folder or marker.
- `storage/tree.ts` reads `.octodo/tasks/` with the task grammar. It also reads each enabled plugin's section folder with that section's marker, and gives its entries to the plugin's reader. At the top of `.octodo/` only config.json, section folders and dot bookkeeping are allowed; anything else is a diagnostic. A disabled plugin's section folder is not read and gets no diagnostic.
- One id sequence covers every section, and so does the id floor from unreadable files. Links and mentions resolve across sections, and the reverse edges are computed across them.
- Every write that creates or moves a task or a list targets `.octodo/tasks/`. `octo init` / `add_workspace` creates `tasks/`, an exception like the one for `.octodo/` itself.
- Paths in diagnostics, `Task.path` and docs all gain `tasks/`. Update AGENTS.md's on-disk model and `docs/architecture.md` in the same commit as the code.
- No migration code (0027). Tests and fixtures move to the new layout.

## Done when

- `pnpm check` passes.
- `bin/octo` on a scratch home creates, moves and lists tasks under `.octodo/tasks/`.
- The web app on a scratch home works as before.
- The bench numbers at 5k tasks have not regressed.
