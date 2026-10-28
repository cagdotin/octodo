---
id: OCT-61
title: "Verify the overhaul: benchmark and CLI end to end"
status: todo
priority: medium
tags:
  - perf
  - architecture
created: 2026-10-28T07:40:28.941Z
order: aH
blocked_by: [OCT-55, OCT-60, OCT-76, OCT-77, OCT-78, OCT-80]
---

## Goal

Prove the overhaul did not regress anything a user feels.

## Scope

- Rerun the baseline script from [[OCT-44]] on the same 1k and 5k scratch workspaces. Status change, rename, create and hand-edit pickup must not regress; explain any number that moved (`benchmark-checklist` skill).
- CLI end to end on a scratch workspace with and without a running server.
- Web app over `pnpm dev:web` and the desktop app over `pnpm dev`, with screenshots deleted after review.
- A fresh reviewer agent reviews the full diff against `31a8506`, the last `master` commit before the overhaul. All overhaul work lands directly on `master`, no branches.

## Done when

- Results added to `docs/research/perf-baseline.md` next to the baseline.
- `docs/architecture.md` has no "Target" section left that the code does not match.

## From OCT-55

- The rules are in decision 0021. The desktop app attaches to the server `server.json` names (via `findServer` from `@octodo/client`), or spawns `dist/server.mjs` with `ELECTRON_RUN_AS_NODE=1`. It restarts a crashed child with a backoff of 0.5, 1, 2 and 4 s, on the same port. After 5 failures in a row, or for a server of another version, one that hangs, or an unreadable `server.json`, it shows a problem page in the window with Try Again and Quit. Quitting stops only the child it spawned.
- Desktop checks need a separate Electron profile, or the single-instance lock hands off to the person's running app: `OCTODO_HOME=<tmp> OCTODO_PORT=<spare> OCTODO_DEV_URL=http://localhost:<vite> apps/desktop/node_modules/.bin/electron apps/desktop --user-data-dir=<tmp>/ud --remote-debugging-port=<p>`. Electron runs `app.quit()` on SIGTERM, so `kill -TERM <main pid>` is a real quit. `screencapture` has no screen permission here; take screenshots of the window through CDP (`Page.captureScreenshot`) instead.
- Vite's dev proxy reads `<home>/server.json` at each request (`OCTODO_API_PORT` still pins it). Run Vite for a scratch home with `OCTODO_HOME=<tmp>` set, e.g. `cd apps/web && OCTODO_HOME=<tmp> npx vite --port <spare> --strictPort`.
- Packaging is not verified with electron-builder: the repo has no electron-builder dependency or config, and it was not in the offline pnpm store. A hand-assembled layout passed: Electron.app copied, binary renamed (`app.isPackaged` keys off the name), `Resources/app/{package.json,dist}` and `Resources/web`. Whether the child loads `server.mjs` from inside `app.asar` is unchecked; 0021 says to put it in `asarUnpack` until it is. Packaging needs its own task.
- `octo serve` now refuses to start while `server.json` names a live server of this version. To run two servers in a test, use separate `OCTODO_HOME`s.
- When attached to `octo serve`, the window shows that server's web build. An `octo serve` started without a web build shows a 404 in the app.
