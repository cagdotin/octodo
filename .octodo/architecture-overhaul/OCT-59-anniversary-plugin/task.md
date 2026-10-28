---
id: OCT-59
title: Anniversary plugin
status: todo
priority: low
tags:
  - plugins
created: 2026-10-28T07:40:21.802Z
order: aF
blocked_by: [OCT-56]
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
