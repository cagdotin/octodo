---
id: OCT-75
title: Sort a list by date as a view choice, for every task kind
status: todo
priority: low
tags:
  - web
  - plugins
created: 2026-10-28T13:11:59.363Z
order: a6
---

## Idea

Lists keep their manual `order`; the anniversary plugin (OCT-59, decision 0020) chose not to add a per-kind sort hook because it would fight drag-and-drop and half-sort mixed lists. Sorting by date is a view choice a person makes for any list: by due date, by a recurring task's next day, by an anniversary's next occurrence.

## Sketch

- A view option per list (manual, by date), stored as a view preference, not by rewriting `order`.
- `PluginWeb` gains `day(fields)` so a kind gives the date the sort reads; a plain task uses `due`.
- Drag-and-drop is off (or switches back to manual) while sorted by date.
