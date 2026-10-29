---
id: OCT-38
title: Sign, notarize and auto-update the desktop app
tags:
  - desktop
created: 2026-10-26T16:04:35.649Z
order: a1
status: backlog
---

\`pnpm package\` builds an ad-hoc signed macOS app with electron-builder ([0024](docs/decisions/0024-the-desktop-app-is-packaged-with-electron-builder.md)). What is left before others can install it, taken over from the old OCT-1:

- **Signing and notarization.** A Developer ID certificate and notarization in the electron-builder config, so Gatekeeper opens the app without a warning.
- **An update source.** Signed builds published somewhere (GitHub releases or a static feed), and electron-updater or Electron's autoUpdater in apps/desktop.
- **A preload bridge.** Update state (available with version, downloading, ready to install) pushed to the web app.
- **A button in the app rail** (\`apps/web/src/components/app-rail.tsx\`), above Settings: shown only while an update is available or ready; one click downloads, the next restarts into it.
