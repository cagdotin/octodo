---
id: OCT-81
title: "Inline composer: create a task of a kind from quick-add text"
status: backlog
priority: low
tags:
  - plugins
  - web
created: 2026-10-28T13:41:17.711Z
order: a1
---

## Problem

The inline composer (`task-composer.tsx`, a list's "add task" row) creates plain tasks only. Since OCT-77 ([0023](docs/decisions/0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md)), kinds are created from the new-task dialog's kind picker. In a Chores workspace, where most tasks repeat, the quick row is the wrong one to reach for.

## Scope

- Weigh a token a kind contributes to quick-add (`every 3 days` makes it recurring; `lib/quick-add.ts` already keeps recurrence text away from chrono, OCT-4) against a kind toggle in the row, or a per-list default kind.
- Counter and anniversary have no natural token. Decide whether the composer offers only kinds that have one.
