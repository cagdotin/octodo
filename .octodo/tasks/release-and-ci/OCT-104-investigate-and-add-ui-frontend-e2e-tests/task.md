---
id: OCT-104
title: Investigate and add UI / frontend e2e tests
status: todo
priority: medium
created: 2026-10-31T08:28:33.010Z
order: a6
---

There is no UI or e2e test harness today (no Playwright, no Electron test runner); pnpm check covers format, lint, React Doctor, tsc and vitest only. Every merge to master ships a nightly that cagin's installed app auto-updates to, so UI regressions reach the live task system untested.

Investigate first, then add:

- Compare options for apps/web (e.g. Playwright against a scratch server via OCTODO_HOME/OCTODO_PORT) and apps/desktop (Playwright _electron or similar with a scratch --user-data-dir).
- Pick one, record it in docs/decisions/.
- Add a first smoke suite covering core flows (open app, quick-add a task, edit, complete, switch list/view) on scratch state only.
- Wire it into pnpm check or ci.yml so PRs run it, keeping runtime reasonable.

Done when: decision recorded, smoke suite runs green locally and in CI on a PR, never touches a real .octodo/.
