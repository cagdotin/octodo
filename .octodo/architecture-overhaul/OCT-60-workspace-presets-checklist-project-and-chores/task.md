---
id: OCT-60
title: "Workspace presets: Checklist, Project and Chores"
status: todo
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
