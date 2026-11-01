# 0031. A recurring task starts on its `start` day, and rules name days of the year

- Status: accepted, amends 0016
- Date: 2026-11-02

## Context

[0016](0016-recurring-tasks-complete-in-place.md) makes a task never done due on the day it was
created, and its grammar has no yearly calendar rule. So a Black Friday wishlist made on October 30
with `every year` was due that day and every October 30 after (OCT-102). Its `due` said November 27,
but 0016 keeps the plain `due` out of the plugin, and a kind's day is its plugin's, never its `due`
([0025](0025-a-kind-gives-its-due-day-and-list-tasks-filters-by-it.md)).

## Decision

- **`start: YYYY-MM-DD`** is a key the recurring plugin owns: the day the task starts from. A task
  never done is due on it, or on the first day its rule names from then. Without one it starts on
  the day it was created, as before. `create_recurring` and `set_repeat` take `start`
  (`octo recurring create --start`), refusing a day the calendar does not have. One that does not
  read in `task.md` is a `recurring/bad-start` diagnostic, and the task starts on its created day.
  `kind.fields.start` gives the day it starts from.
- **`due` stays out of it.** Reading `due` as the start would give one key two meanings, and
  0025's "never a kind's `due`" would no longer hold for the day the task starts.
- **Days of the year.** The grammar gains `yearly on november 27` (also `every year on the 27th of
  nov`; February 29 falls on the 28th in other years) and the nth weekday of a month:
  `monthly on the last friday`, `yearly on the fourth thursday of november`, with an offset before
  it, `yearly on the day after the fourth thursday of november` (Black Friday) or `monthly on 2
  days after the first monday`. `first` to `fifth` and `last`; a month that has no fifth such
  weekday is skipped. They are calendar rules: done early or late, they move past the current due
  as 0016's weekday and month-day rules do.

## Consequences

- A date that moves each year (Black Friday, Thanksgiving, Mother's Day) is a rule, so it stays
  right without a `start` per year.
- The app's create form and panel do not offer `start` yet; the CLI, MCP and HTTP do.
