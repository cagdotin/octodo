---
id: OCT-85
title: CLI without a server rescans the workspace on every read inside one command
status: done
priority: high
tags:
  - perf
  - cli
  - core
created: 2026-10-28T14:58:01.140Z
order: aW
---

## Problem

Found while verifying the overhaul ([[OCT-61]]). With no server running, the CLI opens the engine with `watch: false`. Since 342e1b0 (`state.read` runs `storage.refresh` first), every read forgets the cache, so each `ws.getTask`, `ws.snapshot` and `ws.attachments` call inside one command is a full uncached scan. `update_task` and `get_task` return a `TaskDetail` (`detail` in `engine/src/operations.ts`), which makes three of those reads.

Measured on the bench's generated 5,000-task workspace, wall time of one `bin/octo` call with no server, 3 runs each, alternating, load about 3.3 (ms):

| command        | 31a8506      | d3a1afb      | 09d0300 (after 342e1b0) |
| -------------- | ------------ | ------------ | ----------------------- |
| list           | 1430 to 1740 | 1210 to 1460 | 1680 to 1750            |
| show           | 1400 to 1490 | 1010 to 1050 | 2360 to 2430            |
| update --title | 1560 to 1690 | 2350 to 2490 | 3240 to 3280            |
| update -p high | 1590 to 1740 | 2350 to 2390 | 3220 to 3270            |
| create         | 1800 to 2030 | 1880 to 1930 | 1880 to 1950            |

In-process at 5,000 tasks with `makeWorkspace(..., { watch: false })`: snapshot 540 ms, then getTask 460 ms, attachments 430 ms, snapshot again 470 ms, each a full scan. A process start alone (`octo --version`) is 430 ms.

So `octo show` is about 1 s slower than before the overhaul and `octo update` about 1.6 s slower, the default path for an agent when no app runs. Through a running server the same commands take 600 to 760 ms.

## Repro

```sh
node scripts/bench/workspace.ts --sizes 5000 --runs 1 --keep   # prints the scratch folder
D=<scratch>/workspace-5000; H=$(mktemp -d)
time OCTODO_HOME=$H bin/octo show BN-400 -w $D
time OCTODO_HOME=$H bin/octo update BN-401 -p high -w $D
```

## Direction

A command is one operation: forget once when the operation starts (or when it takes the lock), not at each read inside it. 342e1b0's case (a long-lived process with no watcher that misses other processes' writes) still has to see the new files on its next operation.
