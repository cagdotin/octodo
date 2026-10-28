# 0020. Anniversaries store the day, clients compute the next one, and lists keep their order

- Status: accepted, amended by 0027
- Date: 2026-10-28

> Amended by [0027](0027-plugins-add-sections-tasks-is-the-built-in-one.md) (OCT-89): an anniversary is no longer a task. It is a `yearly` counter in the
> counters section, `counter.md` with `type: yearly` and `date`, created and changed with
> `create_counter` and `update_counter`. The data rule stands: `date` is the only stored value,
> `nextOccurrence` (now in `counters/count.ts`) computes the next one from today where the code
> runs, and February 29 comes back on the 28th. The "Order" section no longer applies: counters
> are not in task lists.

## Context

The anniversary plugin (OCT-59) is a date that comes back every year: a birthday, a wedding. It is
built on the plugin API of [0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md), with
the row, panel and typed client of [0016](0016-recurring-tasks-complete-in-place.md) and
[0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md). Three questions:

- What a read computes. The scan is cached until a file changes, and the next occurrence of an
  anniversary depends on today: the day after a birthday, its next occurrence is a year later.
- When February 29 comes back in a year without one.
- Whether a list of anniversaries is sorted by how soon each comes back, since a list's order is
  the core `order` key and people drag rows to set it.

## Decision

### The data

- `type: anniversary` with `date: 1961-06-14` in `task.md`, the day it first happened. No files.
  `create_anniversary` and `set_anniversary_date` (`octo anniversary create`, `octo anniversary
  date`) refuse a day the calendar does not have; on read such a `date`, or none, is the
  diagnostic `anniversary/bad-date`.
- `kind.fields` is `{ date }`: the day, or null when it cannot be read. Nothing in it depends on
  today, so a cached read is never wrong.
- `anniversary/day.ts` (plain functions, no Effect) computes `nextOccurrence(date, today)`: the
  first day from today, today included, with the date's month and day, and the years it marks
  then (0 when the date itself is still to come). The CLI's `label` and the web half call it with
  the clock where they run: `next 2027-06-14, 66 years`; the row shows "Jun 14, 2027", the panel
  "66 years in 229 days". An agent reads `date` and computes, as the tool descriptions say.
- February 29 comes back on February 28 in a year without one, as the recurring plugin's yearly
  rule does: the celebration stays in February, and a list of birthdays never jumps a month.

### Order

A list keeps its manual order; there is no sort hook in `PluginWeb`.

| Option                                     | What the person gets                                                                                                                                                                                              | Cost                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Manual order** (chosen)                  | Rows stay where they put them, and drag works as on every list. Each row shows when it comes back, so the next one is found at a glance in a short list.                                                          | None. A long list of birthdays needs a drag after each one passes, or the general sort below.                        |
| A per-kind sort hook (`PluginWeb.compare`) | A list of only anniversaries reorders itself each day. In a list that mixes kinds (a birthday next to "buy a gift") the order is half manual and half computed, and a drop that the sort undoes looks like a bug. | A hook in the list view and the board, drag disabled or ignored for sorted rows, and a rule for mixed status groups. |
| Writing `order` from the engine            | The file order matches the next occurrence.                                                                                                                                                                       | A write per anniversary per year that nobody asked for, and it fights the person's own drags.                        |

## Why

- Today-independent fields keep every surface right after midnight without a timer in the engine,
  and `nextOccurrence` is one shared function, so the CLI, the app and the tests agree.
- Sorting by "when does it come next" is a view choice a person makes for any list (by due day,
  by priority), not a property of one kind. Built as a list view option, it would sort plain tasks
  by `due` and kinds by the day their row shows, with drag off while it is on. That is its own
  task; a per-kind hook now would be the first half of it, built for one kind.

## Consequences

- `PluginWeb` is unchanged. A general "sort by date" view option, when it comes, needs each kind's
  row day; `PluginWeb` then gains a `day(fields)` the sort reads. Done for Today and Next 7 days:
  `day` on both halves and `taskDay` in the rules
  ([0025](0025-a-kind-gives-its-due-day-and-list-tasks-filters-by-it.md)).
- Completing an anniversary closes it like a plain task; it has no `complete` hook.
