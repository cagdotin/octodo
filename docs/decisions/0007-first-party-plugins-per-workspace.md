# 0007. Task kinds are first-party plugins, enabled per workspace

- Status: accepted
- Date: 2026-10-28

## Context

octodo will hold more than plain tasks: recurring tasks, days-since counters, anniversaries and
later a habit tracker. A coding project wants a Linear-style tracker and none of those. The survey
found that no studied project lets plugins add first-class data types cleanly, and executor's
vision document argues for "exactly one open seam". bb's rule is that a plugin API core does not
use itself is not ready to ship.

## Decision

- Plugins live in one `@octodo/plugins` package and are all written by us. octodo loads no
  third-party plugin code.
- A workspace enables plugins in its `config.json`. A preset picks the defaults
  ([0008](0008-statuses-per-workspace-presets-as-data.md)).
- The plain task is built in and registered through the same registry API as the plugins.
- A plugin declares:
  - the frontmatter keys it owns, as a versioned schema
  - the files it owns in a task folder (these names stop counting as attachments, and clients
    read what they hold only through the plugin's fields and operations,
    [0011](0011-attachments-are-one-operation-plugin-files-are-private.md))
  - the fields it computes on read
  - its operations, as catalog entries ([0005](0005-one-operation-catalog.md))
  - its validators, as rows in `PROBLEMS`
- A task names its kind in frontmatter (`type: recurring`). A file whose kind is unknown or not
  enabled still loads as a plain task and gets a diagnostic.
- The first plugins are recurring tasks ([0009](0009-recurring-task-is-one-folder.md)), days-since
  counters and anniversaries.

## Consequences

- [0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md) sets the API: the shapes, how
  enablement reaches the scan and the surfaces, problem kinds named `<plugin>/<problem>`, and no
  version number on the keys schema.

- Third-party plugins, if they ever come, need a trust model and must load from `<home>`, never
  from `.octodo/`. That idea is recorded in the Open ideas list.
