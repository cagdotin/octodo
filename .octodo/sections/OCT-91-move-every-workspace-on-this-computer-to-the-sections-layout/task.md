---
id: OCT-91
title: Move every workspace on this computer to the sections layout, once
status: todo
priority: high
tags:
  - migration
created: 2026-10-28T15:52:17.406Z
order: a3
blocked_by: [OCT-90]
---

Phase 4 of [0027](docs/decisions/0027-plugins-add-sections-tasks-is-the-built-in-one.md). It runs after phases 1 to 3 are on master.

- Write a one-off script in the scratchpad, never in the repo, for the workspaces registered in the octodo home on this computer (`workspaces.json`), this repo included. It moves every entry at the top of `.octodo/` (except config.json and dot bookkeeping) into `.octodo/tasks/`. Tasks of `type: counter` or `type: anniversary` become `since` or `yearly` counters in `.octodo/counters/`, keeping their id, title, body, created, order, attachments and log. Their config.json `plugins` then names `counters` in place of `counter`/`anniversary`.
- Back up each `.octodo/` first. Dry-run, check the plan, then run it. Afterwards every workspace reads with no new diagnostics, and the backups are deleted only once that holds.
- The person's running octodo app has to restart on the new build.
- Commit this repo's moved `.octodo/` as its own commit.
