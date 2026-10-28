# 0016. Recurring tasks complete in place, through a hook on the move

- Status: accepted
- Date: 2026-10-28

## Context

[0009](0009-recurring-task-is-one-folder.md) makes a recurring task one folder with a log of
occurrences, and [0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md) the plugin API
it is built on. Three questions were left open:

- How completing a recurring task logs an occurrence. Core `move_task` knows nothing of plugins,
  and the clients are not only the app: an agent on MCP or a script on the CLI that moves a
  recurring task to `done` must get the same outcome as a person who ticks it in the app.
- How the app shows a plugin's fields: 0014 left the web half's component types to this task.
- How `octo list` and `list_tasks` show a recurring task's next due day, since `TaskSummary` had
  no `kind`.

## Decision

### The data

- `type: recurring` with `repeat:` in `task.md`, and `log.jsonl` in the folder, one
  `{"at":"2026-10-25T09:12:00Z","event":"done"}` per line. An occurrence is a UTC minute, and the
  log holds each minute once: logging a minute it has changes nothing, so a retried or
  double-clicked completion writes one line.
- The rule grammar is small: `daily` (and `weekly`, `monthly`, `yearly`), `every [N] day|week|month|year[s]`,
  `every monday[, thursday | and thursday]` (full or three-letter names), and
  `monthly on the 1st` / `every month on the 1st` (a short month uses its last day). An interval
  counts from the day it was last done. A task never done is due on the day it was created (or the
  first matching day from then).
- A calendar rule moves past its current due each time it is done for it: the next due is the
  first matching day after both the due and the day it was done. Done early (Thursday, for a
  Monday chore) skips to the Monday after; done late, to the first Monday after that day. A time
  in an earlier period than the due (history logged with `log_occurrence`, or a second completion
  for a due already moved on) leaves the due where it is. `next` is computed from the whole log,
  oldest first.
- `kind.fields` holds `repeat`, `next` (a `YYYY-MM-DD` day, null when the rule cannot be read),
  `last`, `count` and `recent` (the latest ten, newest first). All are absolute: the scan is
  cached until a file changes, so a relative "in 2 days" would go stale across midnight. Clients
  compute relative text. Days are the calendar days where the engine runs, which is the person's
  computer ([0010](0010-no-authentication-for-now.md)).
- The plain `due` key is untouched and means what it means on any task; the recurring plugin
  neither reads nor writes it.

### Completing

- A plugin's engine half may declare `complete(at) => KindChange`. `moveTask` in the engine, the
  one function every surface's move reaches, checks it: a move of a task of that kind into a
  status of the `completed` category writes the plugin's change (the log line) and puts the task
  in the first unstarted status instead, in the same write under the owner lock. A move into
  `canceled` or `archived` closes it as usual: that ends the series.
- `log_occurrence` records an occurrence now or at a given past time without touching the status,
  for "I did it yesterday". A day alone means its midday here, or now when that midday is still to
  come today, so "I did it today" works in the morning too. `remove_occurrence` takes one back. `list_occurrences` lists them all
  ([0011](0011-attachments-are-one-operation-plugin-files-are-private.md) promised it).
  `create_recurring` and `set_repeat` refuse a rule the grammar does not read.
- `move_task`'s description says what a recurring task does, so an agent knows why the task it
  moved to `done` comes back `todo` with a later `next`.
- Where the plugin is not enabled the task reads as a plain task, and a move to `done` closes it.

### On every surface

- `TaskSummary` has `kind`, so `list_tasks` gives every plugin's fields to agents and scripts.
- A plugin's shared half may declare `label(fields)`, a few absolute words the CLI appends to a
  task line: `every 3 days, next 2026-10-31`. Any operation whose success is a `Task`, a plugin's
  included, prints as a task line unless `--json` is given.
- The CLI groups a plugin's two-word commands under their first word: `octo recurring create`,
  `repeat`, `log`, `unlog`, `history`.

### The web half

- `@octodo/plugins/web` exports `webPlugins`, each plugin's `PluginWeb` by id: `Row` (shown in a
  task row's date slot, in place of the due or created date), `Panel` (a section of the task
  panel) and `completesInPlace` (so the app's optimistic move keeps such a task open, as the engine
  will). The app's seam is `components/task-kind.tsx`: `TaskDate`, the panel and `applyMove` each
  call into it once.
- A web half renders with the app's UI kit (`@/components/ui`, `@/lib`), resolved by the app's
  bundler and the root tsconfig, and Tailwind scans `packages/plugins/src`. It calls only its own
  plugin's operations, through one small function each, since the typed client knows the core
  catalog only. Superseded by [0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md):
  the kit is `@octodo/ui`, and the web half calls its operations through a client typed from them.

## Why

- A hook in the engine's move, rather than clients turning "complete" into the plugin's
  operation, gives one outcome on every surface with no client code: the app's checkbox and board
  drag, `octo move HM-4 done` and an agent's `move_task` all log the occurrence. Client-side
  translation would leave every agent that does not read the plugin's docs closing the series.
- A declarative `complete` returning a `KindChange` keeps plugins on the writes 0014 allows: the
  engine applies it with the move, under one lock, and the plugin never sees a `Files`.
- Minute-precision occurrences make the completion idempotent from the data, not from a guess
  about how close two clicks are.
- A calendar rule advances past its due, not past the day it was done. Counting from the day it was
  done (the first version) left a Monday chore done on Thursday due on that same Monday again: the
  person did it and it stayed due. Someone who takes the bins out early did this week's bins, so the
  next one is next week's. A completion in an earlier period does not count toward the due, so
  logging past history or ticking it twice cannot push the due weeks ahead.
- The date slot is where a row already shows time, and every planned kind (recurring, days-since,
  anniversary) has one date-like thing to show, so the seam is one component, not a second row
  layout.

## Consequences

- Days-since counters (OCT-58) stay a plugin of their own (`type: counter`): another rule, another
  row, another preset. They reuse `log.jsonl`, its line format and `recurring/log.ts` (since moved to
  `log.ts`, [0019](0019-days-since-counters-share-the-occurrence-log.md)), with a
  `reset` event added to the reader. Since a plugin's file is its data only in tasks of its kind
  (0014), OCT-58 makes file claims per kind instead of global, so both can own `log.jsonl`, and
  changing a task's `type` between them keeps its history.
- A kind that wants other behaviour on completion declares its own `complete`; a kind without one
  closes like a plain task.
- The app cannot create a recurring task yet: the composer and the new-task dialog make plain
  tasks. That comes with the Chores preset (OCT-60). Done in
  [0023](0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md).
