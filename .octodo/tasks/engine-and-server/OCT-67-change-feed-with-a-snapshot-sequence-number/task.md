---
id: OCT-67
title: Change feed with a snapshot sequence number
status: backlog
priority: low
tags:
  - idea
  - server
created: 2026-10-28T07:41:09.499Z
order: a1
---

## Why

Today a client that reconnects to the SSE change feed cannot tell what it missed, so it refetches everything or guesses. Related: dropped watcher events in [[OCT-43]], and events carrying task ids in [[OCT-17]].

## The pattern (from the 2026-10-28 survey)

- t3code sends a snapshot with a `snapshotSequence`, then events; the client drops any event at or below the snapshot's sequence (`packages/client-runtime/src/state/shellReducer.ts:138`).
- opencode gives each event a per-aggregate `seq` and sends a `log.synced` marker between replay and live events (`packages/schema/src/event-log.ts`). Each SSE connection has its own bounded queue (4,096 frames); a slow client is disconnected without blocking others (`packages/server/src/event-feed.ts`).

## When

When the web app's refetching becomes a measured problem, or with a native mobile app.
