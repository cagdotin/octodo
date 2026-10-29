---
id: OCT-97
title: Give the dev Electron its own user data folder, so it does not block the installed app
status: todo
priority: medium
tags:
  - desktop
created: 2026-10-29T17:45:20.252Z
order: a4
---

`pnpm dev` runs Electron as "octodo", with the same user data folder as the installed app (`~/Library/Application Support/octodo`). Electron's single-instance lock is per user data folder. So while a dev app runs, an installed octodo opened by hand, or reopened by `octo upgrade`, hands over to the dev window and quits at once. Seen while verifying decision 0029.

Fix: give unpackaged runs their own folder, for example `app.setPath("userData", ... + "-dev")` when `!app.isPackaged`, before `requestSingleInstanceLock()`.
