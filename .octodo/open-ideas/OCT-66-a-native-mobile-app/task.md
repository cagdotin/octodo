---
id: OCT-66
title: A native mobile app
status: backlog
tags:
  - idea
  - mobile
created: 2026-10-28T07:41:05.461Z
order: a2
---

## Not now

The phone uses the web app in a browser over Tailscale, and that is enough for now. Build a native app only if the browser falls short (push notifications, offline reading, home-screen widgets).

## What already prepares for it

- `/api/health` reports a `version` and capability flags ([[OCT-53]]), so an app on an older version can tell what the server supports. t3code adds about 40 such flags, each with a note on what older clients do without it (`packages/contracts/src/environment.ts`).
- The HTTP API publishes OpenAPI ([[OCT-53]]), so a non-TypeScript client can be generated.
- Pairing tokens per device ([[OCT-3]]) and QR pairing ([[OCT-2]]).

## If we build it

- t3code's mobile app connects to any server and shares a client runtime with the web app (`packages/client-runtime`): reducers that apply change events to a snapshot.
- The change feed would need sequence numbers so a reconnecting phone can resume (see the change-feed idea in this list).
