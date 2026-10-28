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

### How the engine builds it (amended by OCT-88)

Building phase 1 settled what the decision left open, keeping to two ideas one level deep:

- **A plugin is a kind of task or a section, not both.** `PluginShared.section` is
  `{ marker }`, and with it everything the plugin declares (`keys`, `files`, `fields`, its reader,
  its problems) is about its section's entries. Its section's id and folder are the plugin's id:
  `.octodo/<plugin id>/`. One name for the three makes two sections in one folder impossible by
  construction, where three names would each need a uniqueness rule. A plugin adds at most one
  section.
- **A section's kinds are its plugin's business.** Counters' `since` and `yearly` are values of a
  `type` key that the counters plugin declares and its reader reads. The engine models kinds only
  in tasks, where each is a plugin; "a kind names its section" becomes: a plugin without a section
  is a kind of task.
- **A plugin's section is flat for now.** Its entries are the folders in its section's folder that
  hold its marker, with no lists and no sub-entries, and there is no flag saying so: no section
  needs them yet, and a flag nothing reads is a promise without code. The first section that needs
  lists adds the flag together with its reader.
- **Keys are claimed per section.** A section plugin's keys never clash with the keys of tasks or
  of another section, since they live in different files. `id`, `title`, `created` and `order` are
  every entry's, so no section plugin declares them. Markers are claimed across sections, with
  `task.md` and `list.md` the tasks section's, so a marker file names its section wherever it is
  copied.
- **A disabled plugin's section is read for its ids only.** It has no entries and no diagnostics,
  but the ids in its markdown raise the id floor like an unread task's, so enabling it again never
  finds a new task holding one of its ids.
- **Folders.** `octo init` makes `tasks/`. A plugin's section folder is made with its first entry,
  inside `.octodo/`, which exists. A missing section folder reads as an empty section.
- **Entries.** The snapshot's `entries` (absent when there are none) carry each entry's `section`,
  its plugin's `fields`, `mentions` and `mentionedIn`. An entry without an id gets one when it is
  read, as a task does. Tasks are read before sections, so of a task and an entry with one id the
  task wins; the entry is a `duplicate-id` diagnostic without a fix, since `fresh-id` renames task
  folders. A `blocked_by` that names an entry is a `broken-link`: links name tasks only.
- **The plugin API.** A plugin's reader gets `{ entry, keys, files }`, where `entry` is what every
  task and entry has (a task is passed whole). A section plugin's handlers create an entry with
  `createInSection(input, keys)`, read them with `entriesInSection` and `getInSection(id)`,
  change one with `editInSection(id, { title, body, keys, files })` (renaming its folder for a
  new title) and remove one with `deleteInSection(id)`, which first takes its id out of every
  task's links, as deleting a task does; entries hold no links of their own. Each writes under
  the owner lock, and an id that is not an entry of the plugin's own section is `EntryNotFound`
  (OCT-89).
- What is neither `config.json`, a section folder nor dot bookkeeping at the top of `.octodo/`, and
  what is not an entry in a section's folder, is a `misplaced` diagnostic.

### How counters are built (amended by OCT-89)

- **Stored and computed.** `counter.md` holds `type` and, for a yearly counter, `date`; a since
  counter's resets are `log.jsonl`. The reader's `fields` are `{ type, since, last, date }`, every
  value absolute, so the cached snapshot is right after midnight (0019, 0020). What depends on
  today (`daysSince`; `next`, `daysUntil` and `years`) is `countOf(fields, today)` in
  `counters/count.ts`, a plain module: each counter operation returns the entry with `count`
  computed where it ran, and the app and the CLI's label call the same function with their own
  today. A `type` the plugin does not know is `counters/bad-type`, a yearly counter without a
  readable day `counters/bad-date`; both count nothing.
- **Operations**, `octo counters ...`: `create_counter` (`create`, with `--type since|yearly`, and
  `--date` for yearly only), `update_counter` (`update`: title, body, a yearly counter's date; the
  type stays), `reset_counter` (`reset`, since only, `--at` for an earlier time), `remove_reset`
  (`unreset`), `list_resets` (`history`), `delete_counter` (`delete`) and `list_counters` (`list`,
  `ls`). There is no `get_counter`: `list_counters` gives every counter whole, body and
  `mentionedIn` included.
- **Today rows.** `PluginShared.day` is any plugin's, for a task of its kind or an entry of its
  section. The snapshot carries nothing new: an entry's day comes from its `fields` and today, as
  a kind's does. `entriesDueBy(entries, last, context)` in `@octodo/contract/rules` makes the rows,
  `EntryDay = { id, section, title, day }`, sorted by day; `list_tasks` with `due_by` appends them
  after the tasks, and a filter only tasks have (status, list, parent, tag, ready) leaves them out.
  The app renders the same rows from its snapshot, and `section` plus `id` is the link to the
  entry's page. A section's web half names its `day` in `webSections`.
- The CLI prints any operation's entry, or list of entries, as an entry line with its plugin's
  `label`, as it prints a task line for a task.

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
