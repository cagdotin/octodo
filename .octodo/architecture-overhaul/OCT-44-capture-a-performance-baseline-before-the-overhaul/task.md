---
id: OCT-44
title: Capture a performance baseline before the overhaul
status: todo
priority: medium
tags:
  - perf
  - architecture
created: 2026-10-28T07:38:59.789Z
order: a0
---

## Goal

Measure today's speed so every later step can prove it did not regress. The scripts from the OCT-6 session are gone.

## Scope

- A script under `scripts/bench/` (checked in, rerunnable) that generates 1k- and 5k-task scratch workspaces under a temp `OCTODO_HOME`, never a real `.octodo/`.
- Measure through `makeWorkspace` with the watcher on: status change, rename, create, a hand edit picked up by the watcher, and a cold open.
- Several runs per number; report median and spread. Follow the `benchmark-checklist` skill.

## Done when

- The script and its results for `master` at the start of the overhaul are committed (results in `docs/research/perf-baseline.md`).
- Reference: OCT-6 took a status change at 5k tasks from 2 s to 86 ms.
