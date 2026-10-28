---
id: OCT-89
title: "Counters plugin: one section with since and yearly kinds"
status: todo
priority: high
tags:
  - plugins
created: 2026-10-28T15:52:08.779Z
order: a1
blocked_by: [OCT-88]
---

Phase 2 of [0027](docs/decisions/0027-plugins-add-sections-tasks-is-the-built-in-one.md). It needs the engine's sections from phase 1.

## Goal

One `counters` plugin replaces `counter` and `anniversary`. It is a section in `.octodo/counters/`, its marker is `counter.md`, and its two kinds are `since` (its `log.jsonl` holds resets) and `yearly` (`date` is the first day).

## Scope

- A counter is not a task: it has no status, priority, due, list or subtasks. It has an id, title, body, created, order and attachments. Its own operations (create, update, reset for `since`, delete, list) go into the plugin's shared half, so the HTTP endpoints, MCP tools, CLI commands and skill are generated from them.
- Yearly counters contribute their next day to Today, Next 7 days and `list_tasks --due-by`, as read-only entries that point at the counter (0025 generalised: an entry of any section can give a day).
- Delete the `counter` and `anniversary` plugins and their operations. The Chores preset enables `recurring` and `counters`.
- Update decisions 0019, 0020 and 0025 where 0027 changes them, plus AGENTS.md and `docs/architecture.md`.

## Done when

- `pnpm check` passes.
- With `bin/octo` on a scratch home you can create, reset and list counters, and they appear in Today. The files on disk match 0027.
