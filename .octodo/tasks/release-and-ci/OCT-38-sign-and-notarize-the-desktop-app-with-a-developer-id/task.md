---
id: OCT-38
title: Sign and notarize the desktop app with a Developer ID
tags:
  - desktop
created: 2026-10-26T16:04:35.649Z
order: a1
status: backlog
---

Auto-update already ships without signing (decision 0029): nightly and stable GitHub releases, an app that swaps its own folder, and `octo upgrade`.

Signing is what remains. Without a Developer ID, a first download is quarantined and the person has to click Open Anyway in System Settings once. Signing and notarizing needs the Apple Developer Program ($99/year), with these secrets in the release workflows: the certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`) and an App Store Connect API key for notarization. t3code's `release-desktop.yml` is a working reference. Once signed, consider moving to `electron-updater`, which needs a signed app; the feeds and channels stay as they are.
