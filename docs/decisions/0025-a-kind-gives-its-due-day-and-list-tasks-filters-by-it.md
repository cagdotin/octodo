# 0025. A kind gives its due day, and Today, Next 7 days and `list_tasks` filter by it

- Status: accepted, amended by 0027
- Date: 2026-10-28

> Amended by [0027](0027-plugins-add-sections-tasks-is-the-built-in-one.md) (OCT-89): the day is a plugin's, not only a kind's. `PluginShared.day` gives the
> day of a task of its kind or of an entry of its section; `DayContext.pluginDay` (was `kindDay`)
> looks it up by plugin id, and `entriesDueBy` in the rules lists the entries due by a day as
> `EntryDay` rows `{ id, section, title, day }`. `list_tasks` with `due_by` gives them after the
> tasks, unless a filter only tasks have (status, list, parent, tag, ready) is set. The
> anniversary kind is gone; a yearly counter gives its next occurrence. A section's web half names
> the same `day` (`webSections`), and the test holds both halves to it.

## Context

Today and Next 7 days listed tasks by `due` only. Since
[0023](0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md) a task of a kind shows
its kind's date in the row and offers no Due, so a chore due today was missing from Today: a
recurring task whose `next` is today, an anniversary that comes back next week (OCT-80). An agent
had no way to ask "what is due today" at all: `list_tasks` had no date filter.

Two facts shape where the rule lives:

- An anniversary's next occurrence depends on today, and the cached scan holds no value that does
  ([0020](0020-anniversaries-store-the-day-clients-compute-the-next.md)). The day has to be
  computed where the question is asked, from `kind.fields` and the clock there.
- A plugin's shared half is Effect Schema code, which the browser does not load; a web half imports
  it as types only (lint, [0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)).
  Plain functions the web half runs live in a module of their own, as `anniversary/day.ts` does.

## Decision

### One function per kind

| Option                                                                   | For                                                                                          | Against                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **`day` on `PluginShared` and `PluginWeb`, one plain function** (chosen) | The engine and the app call the same code; a test holds the two halves to the same function. | Each plugin names the function twice.                                                                       |
| `day` on `PluginWeb` only                                                | One line per plugin.                                                                         | The engine cannot reach it, so `list_tasks` cannot agree with Today.                                        |
| A `next day` in `kind.fields`, written by the scan                       | Every client reads one field.                                                                | Wrong for an anniversary after midnight until a file changes: the cached read cannot hold a relative value. |
| A table of kind ids to day functions in the contract                     | One place.                                                                                   | The contract would know each plugin; a new kind would edit it.                                              |

- `day(fields, today) => Day | null`, a plain function in the plugin's plain module:
  `recurring/rule.ts`'s `dueDay` gives `next` (a past `next` stays, so an overdue chore is due);
  `anniversary/day.ts`'s `occurrenceDay` gives `nextOccurrence(date, today).next`. A counter has
  no `day`: it is never due.
- `PluginShared.day` and `PluginWeb.day` are that same function. `test/due.test.ts` fails if a
  plugin's halves differ.
- `@octodo/contract/rules` holds the rule over it: `taskDay(task, { today, kindDay })` is a plain
  task's `due` day, or the kind's `day`, never a kind's `due`; `isDueBy(task, last, context)` is
  on or before `last`, overdue included. `localDay()` is today where the code runs (the person's
  computer, [0010](0010-no-authentication-for-now.md)).

### Today and Next 7 days

- `filterTasks` takes `kindDay` (`components/task-kind.tsx`, from `webPlugins`) and lists every
  task with `isDueBy` today or today plus seven days, as it did for `due`: overdue plain tasks were
  in Today already, so an overdue chore is too, its date red in the row.
- A `due` on a task of a kind (set over the CLI or MCP) does not put it in Today. The row shows
  the kind's date, so a task listed by a date the row does not show would look misplaced.
- No board or list view groups by date, so nothing else reads `due` for a view.

### `list_tasks` and `octo list`

- `list_tasks` gains `due_by`, a day: the open tasks due on or before it by `isDueBy`, with each
  installed plugin's `PluginShared.day`. `octo list --due-by 2026-11-01` is generated from it. An
  agent's "what is due today" is `due_by` today's date, and gives what the app's Today shows.
- Today is computed at each request, not stored: the summaries stay as the scan has them.

## Why

- **One function, two references.** The engine cannot import the web half and the browser cannot
  import the shared half, so a function both run lives in a third, plain module. Naming it on both
  halves keeps each half self-describing, and the test turns "keep them in sync" into a failure.
- **The rule in the contract.** "A kind's day, never its `due`; on or before, overdue included" is
  one decision. `rules.ts` is the one module the browser and the engine both run.
- **A day, not `today`.** The CLI and MCP already take days as `YYYY-MM-DD`, and an agent knows the
  date. A keyword would be the first relative value in the catalog's inputs.

## Consequences

- A new kind with a date exports `day` from its plain module and names it on both halves. One
  without (a counter) leaves it out.
- `Workspace` exposes `plugins`, the installed ones, so an operation can reach a plugin's shared
  half.
- A "sort by date" list view option ([0020](0020-anniversaries-store-the-day-clients-compute-the-next.md))
  can sort by `taskDay`.
