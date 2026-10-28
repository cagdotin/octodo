---
id: OCT-86
title: The first write after a server starts takes about 1 s at 5,000 tasks
status: todo
priority: medium
tags:
  - perf
  - core
  - server
created: 2026-10-28T15:00:00.611Z
order: aX
---

## Problem

Found while verifying the overhaul ([[OCT-61]]). The first write a process makes takes the owner lock as a new holder, and `onNewHolder` in `storage/storage.ts` runs `forget` and then `cleanUp`. So that one write pays `removeLeftovers` over the whole tree (one sequential `readDirectory` or `lstat` per entry: 360 to 410 ms alone on the bench's 5,000-task workspace, 10,210 entries) plus a full uncached rescan for the snapshot it returns (about 450 ms), on top of the usual write (about 120 ms).

Someone who opens the app (or a desktop launch that spawns the server) and clicks a status first waits about 1 s at 5,000 tasks, against 130 to 170 ms at 31a8506, which removed leftovers while opening. [[OCT-46]] moved the cleanup to the first write and counted it only against the CLI.

Measured, alternating 31a8506's server and today's, 3 rounds, server started, one snapshot read, 2 s idle, then `POST /tasks/:id/move` (ms): 31a8506 132, 170, 164; today 951, 939, 975. In-process (`makeWorkspace`, watch on): first write 919 to 1066, second 169 to 204. A CPU profile of that run is mostly idle, so it waits on file system calls rather than the CPU.

## Repro

```sh
node scripts/bench/workspace.ts --sizes 5000 --runs 1 --keep
H=$(mktemp -d); OCTODO_HOME=$H bin/octo serve --port <spare> &
curl -s -o /dev/null "http://127.0.0.1:<spare>/api/workspaces/<urlencoded root>"; sleep 2
curl -s -o /dev/null -w '%{time_total}\n' -X POST -H 'content-type: application/json' \
  -d '{"status":"in-progress"}' "http://127.0.0.1:<spare>/api/workspaces/<urlencoded root>/tasks/<todo id>/move"
```

## Direction

Measure first. A few ideas: the tree read already lists every folder, so it could report the dot entries it skips and cleanup could remove only those. The server could take the lock once when it opens a workspace, off the click path. And a first hold whose watcher has been running may not need to forget the cache.
