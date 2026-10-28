---
id: OCT-80
title: Today and Next 7 days show tasks by their kind's date
status: done
priority: medium
tags:
  - plugins
  - web
created: 2026-10-28T13:41:13.658Z
order: aU
---

## Problem

Today and Next 7 days filter on `due` only (`filterTasks` in `apps/web/src/lib/tasks.ts`). A recurring task whose `next` is today, or an anniversary next week, is missing from them. Seen while verifying OCT-77: a Chores workspace with "Water the plants" (`every 3 days`, next Today) showed an empty Today. Since [0023](docs/decisions/0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md), a kind's date replaces Due, so these views miss every chore.

## Scope

- A `PluginWeb` (or `PluginShared`) function giving the day a task of the kind is due on, if any: recurring `next`, anniversary's next occurrence, none for a counter. The date views use it in place of `due` for a task of a kind.
- Whether `list_tasks` and the CLI's date filters, if any, should agree, so an agent's "what is due today" matches the app.
