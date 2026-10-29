---
id: OCT-43
title: "Incremental index follow-ups: per-change cost and concurrent scans"
status: backlog
tags:
  - perf
created: 2026-10-27T23:58:58.675Z
order: a2
priority: low
---

Open risks left by OCT-6 (merged as 9fa6f03), rewritten on 2026-10-28 for the new premises.

## Gone or smaller

- **The id walk** (no cap on open files, runs twice per create, skips folders that error): removed by the owner lock in [[OCT-46]], which assigns ids from the holder's own state. The folder reader in [[OCT-47]] adds a global cap on open files.
- **Dropped watcher events** (FSEvents or inotify overflow): with decision 0001, only octodo writes the files, and every octodo write tells the cache which paths it touched. The watcher then only matters for hand edits, which are outside the contract. A dropped event leaves a hand edit unseen until the next change or restart. Accept that, or re-read everything on overflow if it is cheap.

## Still open

- Each change checks every cached key: 10k events over 20k keys blocked the main thread for 611 ms (a large git checkout). Measure again after [[OCT-47]]; fix only if it still shows.
- Two snapshot requests at once each run their own scan. Share one in-flight scan.
- The scan hung four times under `node --cpu-prof` (main thread on an OpenSSL lock); never seen without the profiler. Note only.
