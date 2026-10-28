# Performance baseline before the overhaul

These numbers record how fast `packages/core` was on 2026-10-28, before the architecture overhaul
restructured it. Every later step reruns the same script and compares against this table. A step
that makes a number worse by more than its range explains why in its commit.

## How to rerun

```sh
pnpm bench                                  # 1,000 and 5,000 tasks, 7 runs per number
node scripts/bench/workspace.ts --sizes 5000 --runs 5 --keep
```

The script `scripts/bench/workspace.ts` makes a folder with `mkdtemp` in the OS temp folder, sets
`OCTODO_HOME` inside it, and deletes the folder when it ends (`--keep` leaves it). It never opens
an existing `.octodo/`. It prints the commit, the Node version and a markdown table like the one
below. One full run takes 3 to 4 minutes.

The script imports only `initWorkspace`, `makeWorkspace` and the `Workspace` type from
`packages/core/src/index.ts`, and calls only the `Workspace` methods `snapshot`, `getTask`,
`moveTask`, `updateTask`, `createTask` and `changes`. When the overhaul moves or renames those,
update the import and the calls; nothing else in the script knows the core's internals. It writes
the generated workspace straight to disk in the format `AGENTS.md` describes, so a format change
means updating `generate`. `scripts/bench/tsconfig.json` brings the script into `pnpm typecheck`.

## The workload

Each workspace is generated from a fixed seed, so every run reads the same files:

- 7 lists, one of them nested three levels (`work/clients/acme`).
- 30% of tasks directly in `.octodo/`, 10% subtasks of an earlier task, the rest spread over the
  lists. The largest folder holds about 1,500 task folders at 5,000 tasks.
- Statuses, priorities and due dates mixed; half the tasks have two tags, 5% have a `blocked_by`
  link, and 40% have a one-line body with a `[[BN-n]]` mention. 60% of bodies are empty.

The first open checks that the scan reads every task and reports no diagnostics; the script stops
otherwise.

## What each number times

All operations run through `makeWorkspace(..., { watch: true })`, as the server runs it.

| Operation      | Timed from and to                                                                                           | Checked after                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| cold open      | `makeWorkspace` to the first `snapshot`, in a fresh Node process per run (modules loaded before the clock)  | task count equals the size, no diagnostics         |
| status change  | `moveTask(id, { status })` until it returns the task                                                        | returned status and the `status:` line in the file |
| rename         | `updateTask(id, { title })` until it returns; this renames the folder                                       | new path and the `title:` line in the file         |
| create         | `createTask({ title, list: "work" })` until it returns                                                      | one more task in the snapshot, its id in the file  |
| hand edit seen | a plain `writeFile` of a task's `title:` line until `getTask` returns the new title after a `changes` event | the new title                                      |

Every write returns the task read back from a fresh snapshot, so the write numbers include
rebuilding the snapshot. Each operation runs once as a warm-up, then 7 times, interleaved (status,
rename, create, hand edit, status, ...). Before each one the watcher has been quiet for 300 ms, the
snapshot has been rebuilt, and the process has idled for 2 s, as between two clicks.

The idle matters. With no pause, the operation right after a create or a hand edit was about 40 ms
slower than the same operation after a rename or a status change, so
the numbers depended on the order. With a 2 s pause before every operation, a rename at 5,000
tasks went from 91 ms to 132 ms and a create from 407 ms to 667 ms, and reordering the operations
no longer changed any median by more than its range. A forced GC before each operation did not
remove the effect, and the cache was valid before each one (a `snapshot` took 0 ms), so the cost
is outside octodo's code. The likeliest cause, not measured, is the CPU clocking down or the
process moving to an efficiency core while idle. The table reports the after-idle numbers, since a
person's click usually follows a pause.

## Results

Measured at commit `4f18556` (`packages/core` is identical to `7148555`), on an Apple M1 MacBook
(8 cores, 16 GB, internal SSD), macOS 26.5.2, Node 26.10.0. Median and range of 7 runs. Two full
runs agreed within about 10% on every median; this is the second.

| Tasks | Operation      | Median ms | Range ms    |
| ----- | -------------- | --------- | ----------- |
| 1,000 | cold open      | 265       | 259 to 312  |
| 1,000 | status change  | 53        | 36 to 84    |
| 1,000 | rename         | 52        | 32 to 66    |
| 1,000 | create         | 141       | 122 to 166  |
| 1,000 | hand edit seen | 137       | 120 to 153  |
| 5,000 | cold open      | 971       | 919 to 1151 |
| 5,000 | status change  | 146       | 133 to 178  |
| 5,000 | rename         | 140       | 125 to 186  |
| 5,000 | create         | 630       | 587 to 1087 |
| 5,000 | hand edit seen | 230       | 206 to 375  |

The load average was between 2 and 6 during the runs (a browser and other agents were running), so
expect spread of this size on a desktop in use.

## What limits each number

Measured with `node --cpu-prof` and by timing the pieces alone, at 5,000 tasks, in runs not
reported above.

- **Status change and rename.** Rebuilding the snapshot. A watcher change forgets one path, and the
  next `scanWorkspace` walks every folder again, served from the `ScanCache`: 86 to 118 ms alone,
  against 0 ms when nothing changed. The write itself is a few milliseconds. The profile puts the
  time in the scan's per-entry Effect code, `path.join` and `path.relative`, and `idNumber`, which
  builds a `RegExp` on every call. So these numbers grow with the task count, not the change: a
  status change at 5,000 tasks costs about three times one at 1,000.
- **Create.** Two uncached walks of every id on disk (`nextIdOnDisk` while claiming the id and
  `idElsewhereOnDisk` after the write), 111 to 156 ms each, plus the snapshot rebuild. The profile
  is mostly idle during a create, so the walks wait on file reads rather than on the CPU.
- **Hand edit seen.** The watcher event arrives 89 to 99 ms after the write (FSEvents latency plus
  the 75 ms debounce in `makeWorkspace`), then the snapshot rebuild takes 98 to 137 ms.
- **Cold open.** The full uncached scan reads and parses every `task.md`: 403 to 471 ms in a warm
  process. The rest of the 971 ms is a new process's first run of that code (JIT warm-up). The OS
  file cache is warm in every run; a first open after a reboot is slower and not measured.

## Against the OCT-6 numbers

OCT-6 (commit `ae416f2`) reported 76 ms for a status change at 5,000 tasks, 163 ms for a rename,
470 ms for a create and 89 ms for a hand edit seen, on a different generated workspace and
harness. To tell a regression from a difference in workload, this script ran against
`packages/core` at `ae416f2` and at today's commit, alternating, two rounds each, 5 runs, 5,000
tasks, without the idle pause:

| Operation      | `ae416f2`, two rounds | today, two rounds |
| -------------- | --------------------- | ----------------- |
| cold open      | 1644, 1583 ms         | 923, 918 ms       |
| status change  | 126, 111 ms           | 124, 131 ms       |
| rename         | 78, 75 ms             | 91, 93 ms         |
| create         | 411, 397 ms           | 412, 407 ms       |
| hand edit seen | 204, 183 ms           | 237, 234 ms       |

So the status change was not 76 ms on this workload at `ae416f2` either: the gap to OCT-6's number
is the workload and the harness (this one waits for the watcher to go quiet and rebuilds the
snapshot before each operation), not a regression. Since `ae416f2`, cold open got about 40% faster,
and rename (about 15 ms) and hand edit seen (about 40 ms) got slower, by more than the run-to-run
range. Status change and create did not change measurably.

## After OCT-46

Measured at commit `2f76ae3` against `e8fd424` (master before OCT-46), alternating in one session
on the same machine, load average 2.3 to 3.1. Median and range of 7 runs.

| Tasks | Operation      | Before, ms     | After, ms     |
| ----- | -------------- | -------------- | ------------- |
| 1,000 | cold open      | 250 (239–263)  | 159 (157–188) |
| 1,000 | status change  | 42 (26–67)     | 50 (27–52)    |
| 1,000 | rename         | 53 (45–58)     | 51 (45–56)    |
| 1,000 | create         | 133 (127–168)  | 49 (45–56)    |
| 1,000 | hand edit seen | 137 (124–148)  | 124 (113–141) |
| 5,000 | cold open      | 947 (923–1013) | 564 (560–600) |
| 5,000 | status change  | 138 (134–143)  | 134 (122–151) |
| 5,000 | rename         | 135 (132–144)  | 127 (101–132) |
| 5,000 | create         | 642 (528–683)  | 129 (103–161) |
| 5,000 | hand edit seen | 231 (207–239)  | 228 (217–240) |

- **Create** dropped by about 500 ms at 5,000 tasks: the two uncached id walks are gone, and the
  holder takes the next id from its scan. It now costs what a status change costs (the snapshot
  rebuild) plus the new folder.
- **Cold open** dropped by about 380 ms at 5,000 tasks because opening no longer walks the tree
  for leftovers: `removeLeftovers` alone took 340 to 435 ms on the generated 5,000-task workspace.
  It now runs at a process's first write, inside the bench's warm-up, so the timed writes do not
  include it. A CLI write command still pays it once.
- Status change, rename and hand edit seen are within their ranges. A hold of the owner lock by
  the process that held it last costs about 12 µs.

## After OCT-48

Measured at commit `df4030a` against `9dc25e2` (master before OCT-48), alternating in one session
on the same machine, two rounds of 5 runs each at 5,000 tasks, load average 2.2 to 3.4. Median of
each round.

| Operation      | Before, ms | After, ms |
| -------------- | ---------- | --------- |
| cold open      | 581, 572   | 516, 502  |
| status change  | 141, 132   | 76, 85    |
| rename         | 126, 132   | 89, 77    |
| create         | 139, 132   | 91, 91    |
| hand edit seen | 233, 224   | 200, 188  |

- Every write got about 50 ms faster and cold open about 65 ms. The full `pnpm bench` at
  `df4030a` agrees: 83 ms for a status change and 508 ms for cold open at 5,000 tasks.
- The cause is inferred from the diff, not profiled. Each rescan used to look up every task's
  `task.md` twice more through the cache: once to ask whether the marker was a link, once as a
  child entry of its folder. Now the folder's own read holds the marker, and the scan never visits
  it as a child. The file system calls per task on a cold read stay the same: the `lstat` of
  `task.md` moved into the folder's read.

## After the overhaul (OCT-61)

### The engine, `pnpm bench`

Measured at `d3a1afb` (the overhaul's last feature commit) against `31a8506` (`master` before the
overhaul; its `packages/core` is the one the baseline above measured), alternating in one session on
the same machine: three rounds of the full `pnpm bench`, `31a8506` first in each round, 7 runs per
number. `31a8506` has no bench script, so its run used the script from `750383a` with the import
pointing at `packages/core`; the two copies differ only in that line. Node 26.12.1 on both sides.
The load average was 1.9 to 5.1 in rounds one and two and up to 8.7 in round three, with other
agents and a browser running. Median of each round, in ms.

| Tasks | Operation      | `31a8506`       | `d3a1afb`     |
| ----- | -------------- | --------------- | ------------- |
| 1,000 | cold open      | 238, 241, 254   | 157, 147, 151 |
| 1,000 | status change  | 30, 45, 36      | 23, 36, 23    |
| 1,000 | rename         | 27, 51, 45      | 35, 31, 26    |
| 1,000 | create         | 134, 128, 144   | 26, 33, 19    |
| 1,000 | hand edit seen | 117, 118, 130   | 107, 114, 102 |
| 5,000 | cold open      | 1188, 971, 1162 | 629, 563, 811 |
| 5,000 | status change  | 132, 117, 130   | 104, 122, 101 |
| 5,000 | rename         | 126, 129, 147   | 85, 105, 75   |
| 5,000 | create         | 589, 634, 1090  | 99, 101, 88   |
| 5,000 | hand edit seen | 232, 215, 208   | 189, 198, 169 |

Nothing regressed. Every median at `d3a1afb` is lower than or within the range of `31a8506`'s.

- **Create** is about 500 ms faster at 5,000 tasks, as measured after OCT-46: the holder takes the
  next id from its scan instead of two uncached walks of every id.
- **Cold open** is about 400 ms faster at 5,000 tasks. OCT-46 moved the leftover cleanup from the
  open to a process's first write, and OCT-48 dropped two cache lookups per task from each scan.
  Round three's 811 ms ran at a load average of 8.7. Its range was 669 to 1,663 ms.
- **Status change, rename and hand edit seen** are 20 to 50 ms faster at 5,000 tasks, from
  OCT-48's leaner rescan. They are still bound by rebuilding the snapshot, which walks every
  folder through the cache, so they still grow with the task count.

### Through a running server

The CLI and stdio MCP now run every call on the server when one runs, and the app always has. To
time that path, `octo serve` ran on a scratch home with the bench's generated workspaces, timed over
HTTP and as whole `bin/octo` processes, 5 runs, 2 s idle before each. At 5,000 tasks the load
average was 2.4 to 3.2. Ranges are in parentheses, in ms. These come from a scratch script, not
`pnpm bench`.

| Operation                                   | 1,000 tasks      | 5,000 tasks      |
| ------------------------------------------- | ---------------- | ---------------- |
| first read after the server starts          | 166 (157–180)    | 552 (548–561)    |
| first write after the server starts         | 243 (237–251)    | 961 (918–1002)   |
| HTTP status change                          | 35 (19–43)       | 113 (84–142)     |
| HTTP rename                                 | 69 (62–71)       | 210 (167–457)    |
| HTTP create                                 | 44 (27–49)       | 131 (104–141)    |
| hand edit seen (SSE change event, then GET) | 133 (129–136)    | 212 (187–222)    |
| `octo list`, server running                 | 725 (723–806)    | 769 (751–816)    |
| `octo move <id> <status>`, server running   | 551 (509–591)    | 635 (604–647)    |
| `octo update --title`, server running       | 546 (540–583)    | 759 (672–847)    |
| `octo create`, server running               | 534 (527–603)    | 625 (601–666)    |
| `octo list`, no server                      | 816 (792–945)    | 1760 (1713–1849) |
| `octo move <id> <status>`, no server        | 865 (828–884)    | 1922 (1898–2019) |
| `octo update --title`, no server            | 1173 (1098–1204) | 3370 (3279–3396) |
| `octo create`, no server                    | 879 (856–918)    | 1917 (1896–2004) |

- Starting a process costs 430 ms (`octo --version`, 5 runs), so a CLI call through a running
  server is that plus 100 to 300 ms, against 1.5 to 3 s on its own at 5,000 tasks. Two CLI writes
  through the server left the same owner-lock holder token, and two without a server left two
  different ones, so the calls did run on the server.
- **HTTP status change and create** match the engine's numbers above.
- **HTTP rename** costs about 100 ms more than the engine's, at `31a8506`'s Hono server too:
  alternating the two servers, 3 rounds of 4 runs at 5,000 tasks, rename took 238 ms (203–273) at
  `31a8506` and 237 ms (185–286) today, so it is not a regression. Its limiter is not pinned down.
  In-process at 5,000 tasks, a `getTask` right after an update sometimes rescanned (55 to 87 ms),
  which fits the watcher's report of the write's own change landing before the response does.
- **First write after the server starts** is a regression: about 950 ms at 5,000 tasks, against 130
  to 170 ms at `31a8506` (3 rounds each, alternating). That write takes the owner lock as a new
  holder, which forgets the cache and removes leftovers over the whole tree (360 to 410 ms alone,
  one file system call at a time), and then rescans without a cache. At `31a8506` the open removed
  the leftovers. OCT-86 tracks it.
- **The CLI with no server** got slower for `show` and `update` after `342e1b0`, which forgets the
  cache before every read while no watcher runs. One command then scans the tree three or four
  times. At 5,000 tasks, `octo show` takes 2.4 s against 1.4 s at `31a8506` and 1.0 s at `d3a1afb`,
  and `octo update` 3.2 s against 1.6 s and 2.4 s. OCT-85 tracks it.
