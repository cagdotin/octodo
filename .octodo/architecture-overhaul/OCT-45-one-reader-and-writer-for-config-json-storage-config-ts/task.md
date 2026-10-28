---
id: OCT-45
title: One reader and writer for config.json (storage/config.ts)
status: done
priority: medium
tags:
  - core
  - architecture
created: 2026-10-28T07:39:09.050Z
order: a1
blocked_by: [OCT-44]
---

## Goal

`config.json` is read or written in five places across four files, and they disagree: `scan.ts:337`, `workspaces.ts:96`, `workspace.ts:178` and `:602`, `fixes.ts:158` (plus existence checks in `workspaces.ts:174,195`). Move all of them to `packages/core/src/storage/config.ts`.

## Scope

- Read and edit `config.json` keeping unknown keys (edit through a parsed document, not a re-serialized object).
- One bad config never breaks other workspaces. Today one bad config makes `workspaces.list` fail for every workspace (`workspaces.ts` ~122).
- Behavior-preserving otherwise. Ship the `workspaces.list` fix as its own commit with a test that fails first.

## Done when

- A test: one workspace with a bad config, and `workspaces.list` still returns the others.
- No other module opens `config.json`.
- Checks: `pnpm test`, `pnpm typecheck`, `pnpm exec oxlint --deny-warnings packages apps`, `pnpm exec oxfmt --check .`. The workspace, ids and health tests and `scan-cache.test.ts` pass unchanged.

Docs: `docs/architecture.md`. Plan: `docs/decisions/0004-packages-by-dependency-direction.md`.
