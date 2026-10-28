# 0019. Days-since counters share the occurrence log, and completing one closes it

- Status: accepted
- Date: 2026-10-28

## Context

A days-since counter answers "how long since I last smoked?". [0016](0016-recurring-tasks-complete-in-place.md)
kept it a plugin of its own (`type: counter`) on the recurring task's `log.jsonl`, and left four
questions to OCT-58: how two plugins own one file, what a `reset` line means to each reader,
whether completing a counter resets it, and how the CLI and the app show a count that changes
every midnight while the scan is cached until a file changes.

## Decision

### The data

- `type: counter` in `task.md`, with no keys of its own, and `log.jsonl` in the folder, one
  `{"at":"2026-10-16T10:00:00Z","event":"reset"}` per reset. The line format, the one-line-per-minute
  rule and the code are the recurring task's: `packages/plugins/src/log.ts`, moved out of
  `recurring/` since both plugins use it.
- File claims are per kind ([0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md),
  amended): both plugins own `log.jsonl`, and the task's `type` picks the one reader.
- The log reader knows two events, `done` and `reset`, and both readers count every known event as
  a time the thing happened. A counter that becomes a recurring task (or back) keeps and shows its
  history; an event the reader does not know is a `bad-line` diagnostic. Each plugin writes its own
  word, so the file says what a person did.
- `kind.fields` holds `since` (when the current run started: the last reset, or when the counter
  was created if no reset is earlier), `last`, `resets`, `longest` (the longest run a reset ended,
  in calendar days, which no "now" changes) and `recent` (the latest ten, newest first). Every
  field is absolute; the current count and the best run including it are `counted(fields, now)`
  in the shared half, which the CLI's `label` and the app's row and panel call when they render.

### Operations

`create_counter` (counting from now), `reset_counter` (now or an earlier `at`, idempotent per
minute, a time to come refused), `remove_reset` (take one back) and `list_resets`. On the CLI:
`octo counter create`, `reset`, `unreset`, `history`.

### Completing

A counter declares no `complete`: moving it to a completed status closes it like a plain task,
and `completesInPlace` is false.

### The CLI label

`label` reads absolute fields but runs when a line is printed, so it may count from now:
`12 days since 2026-10-16, best 45 days`. `PluginShared.label`'s doc says so; 0016's "absolute
words" was about the fields, which a cached read must not make relative.

### The web half

`Row` shows `12d` with a timer icon in the date slot. `Panel` shows the count, since when and the
best run, a "Reset now" button, an "Earlier…" popover with a date-time input for a back-dated
reset, and the recent resets, each with a button that takes it back.

## Why

- Counting `done` lines in a counter, and `reset` lines in a recurring task, is what makes
  switching `type` keep the history in more than the file: both events mean "it happened then".
  Reading only its own event would leave a switched task showing an empty history over a full log.
- No `complete`: a reset records that the counted thing happened, which for "days since I last
  smoked" is the opposite of finishing anything. A checkbox tick, a board drag to Done, or an
  agent closing finished work would silently end a streak. A person who stops tracking expects
  Done to close it, as on any task. A reset is one explicit button or command, and taking one back
  is another.
- The engine stores `longest` but not the current count. The current count changes at midnight
  with no file changing, so it would go stale in the cached scan; `longest` only changes with the
  log.
- A counter starts at its creation unless a reset is earlier, so a counter made today for
  something that last happened two weeks ago is one `reset_counter --at` away from the right
  count, and `create_counter` stays a single write without an `at` of its own.

## Consequences

- An agent reading `list_tasks` gets `since` and computes the days itself; the operation
  descriptions say a counter counts from its latest reset.
- The app cannot create a counter yet, as for recurring tasks: that comes with presets (OCT-60).
- A third kind on `log.jsonl` adds its event word to `EVENTS` in `log.ts`.
