---
id: OCT-61
title: "Verify the overhaul: benchmark and CLI end to end"
status: todo
priority: medium
tags:
  - perf
  - architecture
created: 2026-10-28T07:40:28.941Z
order: aH
blocked_by: [OCT-55, OCT-60]
---

## Goal

Prove the overhaul did not regress anything a user feels.

## Scope

- Rerun the baseline script from [[OCT-44]] on the same 1k and 5k scratch workspaces. Status change, rename, create and hand-edit pickup must not regress; explain any number that moved (`benchmark-checklist` skill).
- CLI end to end on a scratch workspace with and without a running server.
- Web app over `pnpm dev:web` and the desktop app over `pnpm dev`, with screenshots deleted after review.
- A fresh reviewer agent reviews the full diff against `31a8506`, the last `master` commit before the overhaul. All overhaul work lands directly on `master`, no branches.

## Done when

- Results added to `docs/research/perf-baseline.md` next to the baseline.
- `docs/architecture.md` has no "Target" section left that the code does not match.
