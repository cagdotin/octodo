---
id: OCT-57
title: Recurring tasks plugin
status: done
priority: medium
tags:
  - plugins
created: 2026-10-28T07:40:15.653Z
order: aD
blocked_by: [OCT-56]
---

## Goal

Decision `docs/decisions/0009-recurring-task-is-one-folder.md`. The first real plugin, and the proof of the registry.

## Scope

- `type: recurring` with `repeat:` in frontmatter (settle the rule grammar: `every 3 days`, `every monday`, `monthly on the 1st`; keep it small).
- `log.jsonl` in the task folder, one line per occurrence: `{"at": "...", "event": "done"}`. Written atomically (temp file and rename).
- Computed on read: next due, last done. No scheduler.
- Operation: log an occurrence (available in the app, CLI and MCP through the catalog). Completing a recurring task in the app logs an occurrence instead of closing it.
- Validators: a bad `repeat` rule, a malformed log line.
- UI: the next due date in list rows, the history in the task panel.

## Done when

- Verified on a scratch workspace through the CLI and the app; the files read back as expected.
