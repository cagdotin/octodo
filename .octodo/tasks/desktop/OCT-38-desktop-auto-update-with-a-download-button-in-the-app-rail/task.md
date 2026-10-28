---
id: OCT-38
title: Desktop auto-update, with a download button in the app rail
tags:
  - desktop
created: 2026-10-26T16:04:35.649Z
order: a1
status: backlog
---

The app rail (apps/web/src/components/app-rail.tsx) has room at the bottom for an update button above Settings, as in ChatGPT's desktop app. Nothing checks for updates yet, so it isn't drawn.

Needs:

- An update source: signed, notarized macOS builds published somewhere (GitHub releases or a static feed), and electron-updater or Electron's autoUpdater in apps/desktop.
- A preload bridge: update state (available with version, downloading, ready to install) pushed to the web app.
- The rail button: shown only while an update is available or ready; one click downloads, the next restarts into it.
