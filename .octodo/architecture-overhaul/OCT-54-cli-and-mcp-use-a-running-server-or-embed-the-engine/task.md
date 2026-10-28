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

## From OCT-53

- `Api` is in `@octodo/contract/api`, so a Node client can use `HttpApiClient.make(Api)` (the Effect runtime is fine outside the browser) or `createClient` from `@octodo/contract/client`, keyed `"METHOD /api/path"`.
- Detect a server with `GET /api/health`: `{ version, capabilities: { operations, mcp, openapi } }`. Compare `version` for the mismatch report.
- The `workspace` path parameter is a registered workspace id only. MCP and the CLI also take a folder path, so `connect()` resolves a path to its registered id (or registers it) before calling HTTP.
- Errors are `{ _tag, ...fields, message }` with the status from `httpApiStatus` on HTTP and the same body in MCP tool errors; decode them with `wireError` from `@octodo/contract` to get the tagged error back, so CLI messages stay identical in both modes.
- Query encoding: `null` is the string `"null"` (for example `?list=null`) and arrays repeat their key.
- Four endpoints are still HTTP only and should become catalog operations once OCT-56 lands: add and remove a workspace, reorder statuses, fix-all (decision 0015). `octo doctor --fix` and `workspace remove` need them in server mode.
- `startServer({ home, port, webDir })` from `@octodo/server` is unchanged and closes open connections (SSE) on `close()`.
- `packages/cli/test/surfaces.test.ts` already runs every catalog call over HTTP against `startServer`; the server-mode CLI can reuse its `httpSurface`.
