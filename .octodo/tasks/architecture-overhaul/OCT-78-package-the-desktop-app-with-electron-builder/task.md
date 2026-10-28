---
id: OCT-78
title: Package the desktop app with electron-builder
status: done
priority: medium
tags:
  - desktop
created: 2026-10-28T13:29:58.919Z
order: aS
---

## Problem

OCT-55 moved the server into a child process (`ELECTRON_RUN_AS_NODE=1` running `dist/server.mjs`, decision 0021), but the repo has no electron-builder dependency or config, so no packaged build was made. OCT-55 checked a hand-assembled, non-asar layout only.

## Scope

- electron-builder config and dependency for macOS (other platforms later).
- Unpack `server.mjs` from `app.asar` (or prove the child runs from inside asar) and the built web app.
- Electron fuses: `RunAsNode` must stay on while the child uses it; if the app is hardened with it off, the child moves to `utilityProcess.fork` (0021).
- Icons from `brand/`.

## Done when

- A packaged app starts on a scratch `OCTODO_HOME`, spawns its server child, recovers a killed child, and attaches to a running `octo serve`.
