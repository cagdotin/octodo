---
id: OCT-84
title: CLI tests with a 5 s limit time out when the machine is loaded
status: todo
priority: low
created: 2026-10-28T14:32:57.714Z
order: aP
---

With several agents running, the load is about 20 on 8 cores. Under that load, one or two tests in `packages/cli/test` that spawn processes, along with the multi-process id tests in `packages/engine/test/ids.test.ts`, time out at vitest's default 5 s. Each passes when run alone, and the base commit `d3a1afb` fails the same way, so this predates the overhaul fixes.

OCT-61 raised the every-surface parity test to 30 s. Find what the rest spend their time on (process start-up, the owner-lock wait) before you raise more limits. That way `pnpm check` before a push stays reliable.
