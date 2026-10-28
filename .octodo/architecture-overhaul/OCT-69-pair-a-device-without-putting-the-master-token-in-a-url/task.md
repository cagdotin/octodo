---
id: OCT-69
title: Pair a device without putting the master token in a URL
status: todo
priority: medium
tags:
  - security
  - server
  - decision
created: 2026-10-28T08:13:55.949Z
order: aL
---

## Problem

`GET /api/pair?token=...` carries the long-lived master token from `<home>/server.json`. It stays in the phone's browser history and in any screenshot of the QR code. A wrong token answers with raw JSON, which a person on a phone can't act on.

## Question

From first principles against the target design (one server reachable over Tailscale, single user, several devices): one-time pairing codes that expire and are exchanged for a session, per-device sessions that can be revoked, or something else? What does a failed pairing show a person?

## Deliverable

A decision record in `docs/decisions/`, then the change on the HttpApi server (after OCT-53). Keep the three security rules in `AGENTS.md`.
