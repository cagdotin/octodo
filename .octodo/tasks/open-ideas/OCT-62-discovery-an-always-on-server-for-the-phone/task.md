---
id: OCT-62
title: "Discovery: an always-on server for the phone"
status: backlog
priority: low
tags:
  - discovery
  - server
created: 2026-10-28T07:40:34.380Z
order: a5
blocked_by: [OCT-69]
---

## Not decided

Do not build this yet. octodo has no remote access for now (decision 0010); a phone first needs [[OCT-69]].

## The question

Should octodo offer an opt-in service (`octo service install`: launchd on macOS) that keeps a server up after login, so other devices and timed features work without the desktop window open?

## What we know (docs/research/2026-10-architecture-survey.md)

- executor and opencode both run a per-user background service. executor's CLI spends about 9.8k lines on daemon lifecycle (elections, stale pids, service install on three OSes, keeping the token out of the plist). opencode spends about 800 lines on elections and version handoff.
- Time-based features need it: a reminder that fires at 09:00, or a recurring task notification, needs a running process. Recurring due dates themselves are computed on read.
- With the server-preferred topology, a service is just another way to start the same server; clients do not change.

## To settle

- Is a reminder or notification feature planned? That is the main reason to need it.
- macOS only, or Linux too?
- How does the desktop app behave when a service already runs (attach, which the attach task already supports)?
