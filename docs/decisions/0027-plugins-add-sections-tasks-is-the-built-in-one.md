# 0027. Plugins add sections; tasks is the built-in one

- Status: accepted
- Date: 2026-10-28
- Amends: [0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md),
  [0019](0019-days-since-counters-share-the-occurrence-log.md),
  [0020](0020-anniversaries-store-the-day-clients-compute-the-next.md)

## Context

A task is something to do: it moves through statuses to done. A days-since counter, an
anniversary or a birthday is a date to keep track of and is never done. Under 0014 every plugin
is a kind of task, so a counter carries a status, a priority, a list and subtasks it has no use
for, and 0019 had to decide what completing one means. The app has one section, Tasks, and a
calendar icon that leads nowhere. More plugins of their own shape are coming: contacts, which a
birthday counter should link to, and perhaps a calendar.

The model has to stay small: two ideas, one level deep.

## Decision

### Sections and kinds

- **A section** is one kind of entry with its own top-level folder `.octodo/<section>/`, its own
  marker file, its own operations, and its own route and sidebar icon in the app. **A kind** is a
  variant of one section's entries, picked by `type` in the entry's frontmatter.
- **Tasks is the built-in section.** It lives in `.octodo/tasks/`, its marker is `task.md`, and it
  is always on. That folder is the root list, so lists, tasks, subtasks and attachments keep the
  grammar AGENTS.md describes, one level down. The plain task is its built-in kind, as in 0014.
- **A plugin contributes sections, kinds of a section, or both.** Recurring is a kind of tasks.
  Counters is a section with two kinds of its own. A kind names its section, and tasks is the
  default. Kinds never have kinds; nesting stops there.
- A workspace still enables plugins by id in config.json's `plugins`. The section of a plugin that
  is not enabled is not read, has no route and no icon, and its operations fail with
  `PluginNotEnabled`. Its folder is left as it is, with no diagnostic, so enabling the plugin again
  brings it back.
- At the top of `.octodo/` there are only config.json, the folders of sections, and dot
  bookkeeping. Anything else there is a diagnostic, like a loose file anywhere else.

### Entries across sections

- One id sequence per workspace covers every section: `HM-41` can be a task and `HM-42` a counter.
  A link or a `[[HM-42]]` mention can name an entry in any section, and the reverse edges
  (`blocks`, `mentionedIn`) are computed across sections. `blocked_by` still names only tasks.
- Every section's entries share the entry grammar: a folder `<id>-<slug>/` holding the section's
  marker file, whose frontmatter has `id`, `title`, `created` and `order`. Other files are
  attachments, except the ones the entry's kind owns. A section decides whether it has lists and
  sub-entries. Counters has neither for now.

### Counters

- One `counters` plugin replaces the `counter` and `anniversary` plugins. Its marker is
  `counter.md`. Its two kinds are:

  | `type`   | Holds                                              | Shows                                          |
  | -------- | -------------------------------------------------- | ---------------------------------------------- |
  | `since`  | `log.jsonl`, one line per reset, as 0019 kept it   | days since the last reset (or since `created`) |
  | `yearly` | `date`: the day it first happened, as 0020 kept it | the next occurrence, computed from today       |

- A counter has no status, priority, due date, list or subtasks. It has a title, a body and
  attachments, can be linked or mentioned, and is deleted rather than completed.
- A yearly counter whose next day is today or within the next 7 days shows in Today and Next 7
  days as a read-only row that opens the counter. [0025](0025-a-kind-gives-its-due-day-and-list-tasks-filters-by-it.md)'s
  due day becomes a contribution any section's entry can make to those views.
- The Chores preset enables `recurring` and `counters`.

### Moving existing workspaces

- octodo keeps no migration code. The workspaces on this computer are moved once by a script run
  outside the repo: every entry at the top of `.octodo/` moves into `.octodo/tasks/`, and every
  task of `type: counter` or `type: anniversary` becomes a counter in `.octodo/counters/`
  (`since` or `yearly`), keeping its id, title, body, created, order, attachments and log.
- A workspace in the old layout after that is outside the contract: it reads with diagnostics like
  any other file in the wrong place.

## Consequences

- The tree reader learns sections: it reads `.octodo/<section>/` for each section the workspace
  enables, with that section's marker. Every path a diagnostic or a task names gains `tasks/`.
- The snapshot carries counters next to tasks, and `get_workspace` names the enabled sections so
  a client knows which routes to show.
- The `counter` and `anniversary` plugins and their operations go; the `counters` plugin brings
  its own (create, update, reset, delete, list). Decisions 0019 and 0020 keep their file formats;
  their "a counter is a task" parts are replaced by this one.
- The app's sidebar lists the enabled sections, Tasks first. The calendar placeholder is removed.
- A future contacts plugin is a section, and a birthday counter can link to a contact by id.
