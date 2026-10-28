---
id: OCT-51
title: Split core into contract and engine packages
status: todo
priority: medium
tags:
  - architecture
  - web
created: 2026-10-28T07:39:42.345Z
order: a7
blocked_by: [OCT-50]
---

## Goal

Decision `docs/decisions/0004-packages-by-dependency-direction.md`. `@octodo/core` serves both the browser and the backend; split it so clients depend only on a contract.

## Scope

- `@octodo/contract`: schemas (`domain.ts`), later the operation catalog, and `rules.ts` (renamed from `layout.ts`). `rules.ts` keeps only rules that run per keystroke or drag hover: `isClosedCategory`, `sortStatuses`, `defaultStatus`, `movedListId`, `listMoveError`, `inSubtree`, `listDepth`, `findMentions`, `LINK_KINDS`, `slugify`, `deriveKey`, `humanize`, plus the rules the web needs for optimistic updates (`taskSubtree`, the blocked rule). No Effect runtime or Node imports in `rules.ts`.
- `@octodo/engine`: everything else from core.
- Put `ready` in the snapshot next to `blocked`.
- Replace the web copies: `apps/web/src/lib/tasks.ts` `subtreeIds` (copy of `taskSubtree`), `movedContainer` (copy of `destination`), `openBlockers`/`withBlockedBy` (copy of the blocked rule). Decide "a note is not a problem" once, not in both `cli/main.ts:68` and `app-sidebar.tsx:323`.
- A lint rule (`no-restricted-imports`) forbids `apps/web` and the desktop renderer from importing `@octodo/engine`.
- Update every `@octodo/core/layout` importer (13 files in `apps/web`).

## Done when

- The built web bundle contains no engine code (check the build output).
- Same checks as the rest of this list.
