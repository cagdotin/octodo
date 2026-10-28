# 0014. One plugin API for the plain task and every plugin

- Status: accepted
- Date: 2026-10-28

## Context

[0007](0007-first-party-plugins-per-workspace.md) makes task kinds first-party plugins, enabled
per workspace, with the plain task registered through the same API. It named what a plugin
declares but not the shapes, where each half lives, how a workspace's choice reaches the scan and
the surfaces, or what a disabled plugin's task looks like. [0004](0004-packages-by-dependency-direction.md)
had the engine import the plugins, which would make a cycle: a plugin's handlers need the
engine's `Workspace`.

## Decision

### Packages

- `@octodo/plugins` depends on `@octodo/contract` and `@octodo/engine`, not the other way round.
  Its main entry exports `plugins`, every plugin's `engine` half. Each plugin is a folder with
  `shared.ts`, `engine.ts` and `web.tsx`, and the package exports `./<plugin>/shared` and
  `./<plugin>/web` for the browser.
- The processes pass `plugins` to `Workspaces.layer({ home, watch, plugins })`; the CLI also builds
  its commands from `makeRegistry(plugins)`. The MCP layer builds its tools from the `plugins` the
  `Workspaces` service holds, so the two cannot disagree.
- Lint keeps a plugin's `shared.ts` free of Node and the engine, and its `web.tsx` and the web app
  off `@octodo/engine`, `@octodo/plugins` (the engine side) and any `engine` entry.

### What a plugin is

- One plugin is one kind. Its `id` is its name in config.json's `plugins` and the `type` its tasks
  name in frontmatter.
- The shared half is a `PluginShared` (`@octodo/contract/plugin`): `keys` (a struct of the
  frontmatter keys a task of its kind holds), `files` (names at the top of the task folder that are
  its data), `fields` (the struct it computes on read), `operations` (catalog entries) and
  `problems` (the remedy of each problem it reports).
- The engine half comes from `definePlugin(shared, { read, handlers })`, typed from the shared
  half. `read({ task, keys, files })` gets the task as the plain task read it, the raw values of
  its keys and the text of its files, and returns `{ fields, problems }`. Each handler gets a
  `PluginWorkspace`: the `Workspace`, plus `createOfKind(input, keys)` and
  `editOfKind(id, { keys, files })`, which write only that plugin's keys and files, in tasks of its
  kind, under the owner lock like every other write.
- The plain task is `plainTask`, a `PluginShared` too: its keys are every key `task.md` has
  (`type` among them), which is what keeps them out of `extra`, and its operations are the
  catalog. Its reader is the one every kind extends, and its problems are the `PROBLEMS` table,
  whose rows can carry fixes.
- `makeRegistry(plugins)` merges the plain task's and the plugins' operations and runs any of them.
  It and `Workspaces.layer` throw at startup when two claim one kind, key or operation name,
  when a file is not a plain name (a marker, a `.md`, a hidden name or a path), or when an
  operation lacks a handler or does not run in a workspace. Two plugins may name the same file
  (amended by OCT-58): a file is claimed per kind, below.

### In a workspace

- config.json's `plugins` lists the enabled ids. An id octodo has no plugin for is an
  `invalid-config` diagnostic on `plugins`, and is ignored.
- A task's `type` picks its kind. No `type`, an empty one or `task` is the plain task. Any other
  value that is not an enabled plugin's id reads the task as a plain task with an `unknown-kind`
  diagnostic, and that plugin's keys stay in `extra`. `type` itself is a plain-task key, never in
  `extra`.
- A task of an enabled kind gets `kind: { id, fields }`, the fields encoded through the plugin's
  `fields` schema, and its plugin's keys leave `extra`. The snapshot and `get_workspace` give
  `plugins`, the enabled ids. Both keys are absent when there is nothing to say, so a workspace
  without plugins reads exactly as before.
- A plugin's files are its data only in tasks of its kind. There the tree reads their text for the
  reader, the attachment listing leaves them out, `read_attachment` answers `AttachmentNotFound`
  ([0011](0011-attachments-are-one-operation-plugin-files-are-private.md)), and an upload with that
  name, in any case, is refused. In a plain task the same name is an ordinary attachment.
- A plugin's problem is the diagnostic kind `<plugin>/<problem>` (`recurring/bad-repeat`), with its
  remedy appended as for every kind. Pointing at one of its files puts the diagnostic on that file.
  A plugin's problems have no fixes yet; one that needs a fix adds it to the fix model then.

### On every surface

- Every installed plugin's operations are MCP tools, CLI commands (when they have `cli`) and
  skill lines, whichever workspace is in use: the tool list is made once per process, before a
  workspace is known. A call into a workspace that does not enable the plugin fails with
  `PluginNotEnabled`, which the registry adds to each plugin operation's errors. The exported
  skill lists them all for the same reason.
- The web app takes a plugin's `web` entry by `task.kind.id`. A task row and the task panel each
  render that entry's part for a task whose `kind` is set, and nothing for a plain task, so a
  plugin shows only where it is enabled. Its props are the task, with `kind.fields` typed as the
  `Encoded` side of the plugin's `fields` schema. [0016](0016-recurring-tasks-complete-in-place.md)
  settles the component types (`PluginWeb`: `Row`, `Panel`, `completesInPlace`).

## Why

- A version number on the keys schema was left out. Nothing on disk records which version wrote a
  file, so a number has nothing to be compared with; a plugin that changes its keys decodes every
  shape it ever wrote, and the strict read reports anything else.
- Prefixing a plugin's problem kinds with its id makes a clash between plugins, or with a core
  kind, impossible by construction instead of a startup check, and tells a reader which plugin
  speaks.
- Listing every installed operation, against `EnabledWhen` per MCP session, keeps one tool list
  per process, the same on MCP, the CLI and the skill, and the contract test table simple.
- Reserving a plugin's files only in its own tasks lets a plain task keep an attachment named
  `log.jsonl`, and makes a task's kind the one thing that decides what its folder holds. For the
  same reason two plugins may own one name: the kind still picks the one reader of the file, and a
  task whose `type` changes between them keeps the file
  ([0019](0019-days-since-counters-share-the-occurrence-log.md)).

## Consequences

- `Task.kind`, the snapshot's and overview's `plugins` and `DiagnosticKind` are wider in the
  contract, and MCP's schemas show it, even with no plugin installed. `kind` and `plugins` are
  `optionalKey`: absent when there is nothing to report.
- The server serves `makeApi(registry.operations)`, so a plugin's operations are endpoints at their
  `http` paths, and `PluginNotEnabled` is a 409. Clients are typed from `Api`, the catalog alone; a
  plugin's web half calls its own operations through the same client, typed from them
  ([0017](0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)).
- Days-since counters and recurring tasks both own `log.jsonl` as two plugins
  ([0016](0016-recurring-tasks-complete-in-place.md),
  [0019](0019-days-since-counters-share-the-occurrence-log.md)): file claims were global at first,
  and OCT-58 made them per kind.
- `createOfKind` and `editOfKind` are the only writes a plugin has (`filesOfKind` reads its files,
  and `complete` is a change the engine writes with a move, [0016](0016-recurring-tasks-complete-in-place.md)). One that needs another (moving
  its file, writing two tasks) adds it to `PluginWorkspace`, not a way around storage.
