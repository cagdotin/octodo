---
id: OCT-79
title: Turn an existing task into a kind ("make it repeat")
status: backlog
priority: low
tags:
  - plugins
  - web
created: 2026-10-28T13:41:08.602Z
order: aT
---

## Goal

A person who added "Water the plants" as a plain task should be able to make it repeat without deleting it and creating a new one. OCT-77 ([0023](docs/decisions/0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md)) creates a task of a kind only at creation time.

## Scope

- A new operation per kind or one generic `set_kind` that writes `type` and the kind's keys (`repeat`, `date`) on an existing task under the owner lock, and refuses a kind the workspace does not enable. Decide which against 0014 (a plugin owns its keys; the core has no `type` writes today).
- What happens to `due` when a task becomes a kind (0023: a kind's date replaces Due), and to `log.jsonl` when it changes between recurring and counter (0016 keeps the history).
- Turning a kind back into a plain task.
- In the app: the task panel's `...` menu, and the disabled "Repeat" row in `DuePicker`, which promises this today.
