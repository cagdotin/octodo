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
