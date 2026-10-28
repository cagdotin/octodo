---
id: OCT-59
title: Anniversary plugin
status: done
priority: low
tags:
  - plugins
created: 2026-10-28T07:40:21.802Z
order: aF
blocked_by: [OCT-56, OCT-74]
---

## Goal

Dates that come back every year (birthdays, anniversaries). Decision `docs/decisions/0007-first-party-plugins-per-workspace.md`.

## Scope

- `type: anniversary` with `date: 2019-06-14` in frontmatter. No log file.
- Computed on read: next occurrence, years since, days until.
- Validator for a bad date.
- UI: next occurrence in list rows; sorted by days until in its list.

## Done when

- Verified on a scratch workspace through the CLI and the app. Should be small if the registry is right; if it is not, fix the registry.

## From OCT-56

- Model it on the recurring plugin (OCT-57) and `packages/plugins/test/tally/`: `packages/plugins/src/anniversary/{shared.ts,engine.ts,web.tsx}`, added to `plugins`. Use the web seam OCT-57 builds.
- `keys: { date }`, no files, problem `bad-date` (its kind is `anniversary/bad-date`). A key is a global claim: no other plugin can then own `date`.
- The scan is cached until a file changes, so "days until" computed on read goes stale across midnight. Store or compute the absolute next occurrence, and let clients compute relative text from it.
- "Sorted by days until in its list" needs either a sort hook per kind or web-side sorting, since list order (`order`) is core. Decide, and record it.
- Its operations become HTTP endpoints at their `http` paths automatically (the server serves `makeApi(registry.operations)`); `PluginNotEnabled` is a 409.
