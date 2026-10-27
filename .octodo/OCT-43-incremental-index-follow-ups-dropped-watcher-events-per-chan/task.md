---
id: OCT-43
title: "Incremental index follow-ups: dropped watcher events, per-change cost, id walk"
status: backlog
tags:
  - perf
created: 2026-10-27T23:58:58.675Z
order: aM
---

Open risks left by OCT-6 (merged as 9fa6f03):

- If the OS watcher drops events (FSEvents/inotify overflow, an event with no path), those paths stay stale until they change again or the app restarts. Before OCT-6 the next event anywhere healed it. Re-read everything on overflow, or on a slow periodic tick.
- Each change checks every cached key: 10k events over 20k keys blocked the main thread for 611 ms (a large git checkout).
- The id walk in ids.ts reads 16 folders at a time per level with no overall cap on open files, and silently skips a folder that errors. Every create runs it twice; create is the slowest write (489 ms at 5k).
- Two snapshot requests at once each run their own scan.
- The scan hung four times under node --cpu-prof (main thread on an OpenSSL lock); never seen without the profiler.
