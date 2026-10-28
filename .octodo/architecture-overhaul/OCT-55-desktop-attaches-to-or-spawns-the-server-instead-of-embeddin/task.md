---
id: OCT-55
title: Desktop attaches to or spawns the server instead of embedding it
status: todo
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
