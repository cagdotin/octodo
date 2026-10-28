---
id: OCT-58
title: Days-since counter plugin
status: todo
priority: medium
tags:
  - plugins
created: 2026-10-28T07:40:18.754Z
order: aE
blocked_by: [OCT-57]
---

## Goal

Track how long since something last happened ("days since I last smoked"). Decision `docs/decisions/0007-first-party-plugins-per-workspace.md`.

## Scope

- `type: counter`. Reuses the `log.jsonl` format from the recurring plugin: a reset is a line.
- Computed on read: days since the last reset, longest streak.
- Operation: reset (log a line now, or at a given time).
- Validators for malformed lines.
- UI: the count in list rows; the history in the task panel.

## Done when

- Verified on a scratch workspace through the CLI and the app.
