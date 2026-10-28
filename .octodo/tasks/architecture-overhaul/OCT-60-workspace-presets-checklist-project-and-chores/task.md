---
id: OCT-60
title: "Workspace presets: Checklist, Project and Chores"
status: done
priority: medium
tags:
  - plugins
  - web
created: 2026-10-28T07:40:25.213Z
order: aG
blocked_by: [OCT-56, OCT-57]
---

## Goal

Decision `docs/decisions/0008-statuses-per-workspace-presets-as-data.md`.

## Scope

- A preset is JSON: a statuses block, the plugins it enables, optional starter lists.
- Checklist: `todo`, `done`. Project: backlog through canceled (today's default). Chores: a checklist with recurring tasks enabled.
- Chosen when a workspace is created (add-workspace dialog, `octo init`/workspace add, MCP), then copied into `config.json`. Later changes to a preset do not touch existing workspaces.
- Workspace settings can enable or disable plugins afterwards.

## Done when

- Creating a workspace from each preset on a scratch `OCTODO_HOME` writes the expected `config.json`.

## From OCT-56

- `config.json`'s `plugins` is already read and validated (an id octodo has no plugin for is an `invalid-config` diagnostic). `initWorkspace` and `createWorkspace` need a `plugins` option so a preset can write it.
- Enabling or disabling later is a `config.json` write through `files.editConfig`, e.g. a `set_plugins` catalog operation. Disabling turns that kind's tasks into plain tasks with `unknown-kind`, and their plugin files become attachments again.
- An `enable-plugin` fix for `unknown-kind`, like `add-status` for `unknown-status`, would fit; it isn't built.
- No API lists the plugins octodo has (the engine has `Workspaces.plugins`), so the settings page needs one.
- Add and remove workspace, reorder statuses and fix-all are still hand-declared HTTP endpoints (0015); presets touch add-workspace, so moving it into the catalog here is natural.

## From OCT-57

- Chores enables `recurring`.
- The app cannot create a recurring task yet: the composer and the new-task dialog make plain tasks only. Add a repeat field there (it calls `create_recurring`), or a "make it repeat" conversion, a new operation that writes `type` on an existing task.
- Enabling a plugin still means editing `config.json` by hand; the settings page should do it.
- A plugin web half builds on `@octodo/ui` and a client typed from its own operations (0017).
