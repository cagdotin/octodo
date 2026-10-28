---
id: OCT-55
title: Desktop attaches to or spawns the server instead of embedding it
status: done
priority: medium
tags:
  - architecture
  - desktop
created: 2026-10-28T07:40:05.389Z
order: aB
blocked_by: [OCT-54]
---

## Goal

`apps/desktop/src/main.ts` runs the server inside Electron's main process, and starts a second server on a random port when `octo serve` holds 4520. A crash in a watcher or parser takes the window down.

## Scope

- On launch, attach to a running server found through `server.json`. Otherwise spawn one as a child (`ELECTRON_RUN_AS_NODE=1`) and wait for a ready line or a health probe. Restart with backoff after a crash.
- The renderer gets the origin over IPC, then talks HTTP.
- Packaged builds still work (`electron-builder`); dev (`pnpm dev`) still works.
- Reference: t3code `apps/desktop/src/backend/DesktopBackendManager.ts`, executor `apps/desktop/src/main/sidecar.ts`.

## Done when

- `pnpm dev` and a packaged build both open the app; killing the server child is recovered.
- With `octo serve` running, the desktop app attaches to it instead of starting a second server.

## From OCT-54

- Decision `docs/decisions/0018-connect-finds-the-server-through-server-json.md` has the rules. `startServer` writes `<home>/server.json` (`{ url, pid, version }`, the `ServerInfo` schema in `@octodo/contract`) once it listens, and removes it on `close()` only if it still names that url and pid. A spawned child running `startServer` writes it for free; the desktop needs no code for that.
- To attach, apply the same rules as `connect()` in `packages/client/src/connect.ts`: `readServerInfo(home)` from `@octodo/engine`; a dead pid or `ECONNREFUSED` means no server (spawn one); `/api/health` with another `version` (`VERSION` from `@octodo/contract/api`) or no answer in 2 s must be shown to the person, not replaced silently. Consider exporting the `usable(info)` probe from `@octodo/client` and reusing it rather than copying it.
- The last server to start owns `server.json`. Today the desktop's second server on a random port would take it over from `octo serve`; attaching removes that case.
- Nothing stops `octo serve` from starting while another server already answers (it fails only on a taken port). Once the desktop attaches, consider making `octo serve` refuse when `server.json` names a live server of this version.
- `startServer` must still be closed cleanly (SIGTERM to the child) so the file goes; a SIGKILLed child leaves it, which clients treat as stale through the pid check.
- The server now takes an absolute folder in any `:workspace` path segment, and keeps a handle and watcher per folder named (keyed by real path, never evicted).
