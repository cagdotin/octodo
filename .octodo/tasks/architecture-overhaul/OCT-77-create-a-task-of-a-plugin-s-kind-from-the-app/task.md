---
id: OCT-77
title: Create a task of a plugin's kind from the app
status: done
priority: medium
tags:
  - plugins
  - web
created: 2026-10-28T13:24:34.392Z
order: aR
blocked_by: [OCT-60]
---

## Goal

The app's composer and new-task dialog create plain tasks only. Recurring (`create_recurring`), days-since counters (`create_counter`, OCT-58) and anniversaries (`create_anniversary`, OCT-59) can be created from the CLI and MCP but not from the app, so a Chores workspace (OCT-60, decision 0022) cannot make its first chore in the app.

## Scope

- Shape it once for every kind: a kind picker driven by the workspace's enabled plugins (`snapshot.plugins`), with each plugin's `PluginWeb` contributing its own create fields (repeat rule, date) and calling its own create operation through its typed client (0017). No recurring-only repeat field.
- Decide whether "make it repeat" (turning an existing plain task into a kind, a new operation writing `type`) belongs here or in its own task.
- Quick-add tokens for a kind (e.g. `every 3 days`) are worth weighing against the picker.

## From OCT-60

- Presets and plugin settings are in: `@octodo/contract/presets`, `add_workspace`, `list_plugins`, `enable_plugin`, `disable_plugin`, and Settings > Plugins in the app.
- `PluginShared` now has `name` and `description`, which a kind picker can show.
- The three kinds were combined on `integ-plugins`; build this after they reach master.
