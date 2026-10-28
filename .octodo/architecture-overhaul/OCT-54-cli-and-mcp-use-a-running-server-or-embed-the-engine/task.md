---
id: OCT-54
title: CLI and MCP use a running server, or embed the engine
status: todo
priority: medium
tags:
  - architecture
  - cli
  - mcp
created: 2026-10-28T07:40:01.175Z
order: aA
blocked_by: [OCT-53, OCT-46]
---

## Goal

Decision `docs/decisions/0002-server-preferred-topology.md`. Today every surface opens `.octodo/` itself (the CLI's one-shot commands and `octo mcp` in `packages/cli/src/main.ts`).

## Scope

- `<home>/server.json` is written again, with `url`, `pid` and `version` (no secrets, decision 0010). It is a discovery hint; the owner lock is the proof.
- `@octodo/client` `connect()`: probe `/api/health`; if a compatible server answers, use HTTP; if none is running, embed the engine under the owner lock. Never write behind a server that `server.json` names but that does not answer: report it instead.
- The CLI and stdio MCP go through `connect()`. Stdio MCP bridges to the server's HTTP MCP when one runs.
- A version mismatch is reported to the user, not silently replaced.
- Why it matters for speed (OCT-46): the owner lock is held per write, and when two processes take turns writing, each handover makes the new holder rescan, about 450 ms at 5,000 tasks. Routing CLI and MCP through a running server removes those handovers. Measure it with `pnpm bench` plus a two-process scenario.

## Done when

- The CLI end to end on a scratch workspace (`OCTODO_HOME=<tmp> bin/octo ...`) gives identical files and output with a server running and without one.
- The contract test table from the catalog task runs in both modes.
- Same checks as the rest of this list.
