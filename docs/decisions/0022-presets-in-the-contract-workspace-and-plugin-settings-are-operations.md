# 0022. Presets live in the contract, and adding a workspace and choosing its plugins are operations

- Status: accepted
- Date: 2026-10-28

## Context

[0008](0008-statuses-per-workspace-presets-as-data.md) makes a preset a named template copied into
`config.json` when a workspace is created, and leaves open where presets live and how a person or
an agent picks one. Choosing a preset has to work in the app's add-workspace dialog, in `octo init`
and over MCP. Adding a workspace was a hand-declared HTTP endpoint and a `Connection` method
([0015](0015-http-endpoints-outside-the-catalog.md)), so MCP had no way to do it at all. Enabling a
plugin afterwards meant editing `config.json` by hand, and nothing listed the plugins octodo has
([0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md)).

## Decision

### Presets

- `@octodo/contract/presets` (`packages/contract/src/presets.ts`) holds `PRESETS`, keyed by id in
  the order the dialog shows them. A `Preset` is `{ name, description, statuses, plugins }`. The
  module imports only types, so the browser imports it at runtime, as it does `rules.ts`.
- Checklist is `todo` and `done`. Project is `backlog`, `todo`, `in-progress`, `done`, `canceled`
  and `archived`. Chores is Checklist's statuses with `plugins: ["recurring"]`.
- Project is `DEFAULT_PRESET`: a workspace created without a preset gets it, and
  `DEFAULT_STATUSES`, what a `config.json` without `statuses` shows, is its statuses. That adds
  `canceled` to the old default, as 0008 named it.
- `initWorkspace` copies the preset's statuses, and its plugins when it has any, into the new
  `config.json`. A folder that already holds a workspace is registered as it is: the preset, name
  and key apply only to a new one.
- No preset has starter lists, so a `Preset` has no field for them. One that wants them adds it.

### Operations

| Operation        | Input                                      | Success                               | HTTP                                            | CLI                              |
| ---------------- | ------------------------------------------ | ------------------------------------- | ----------------------------------------------- | -------------------------------- |
| `add_workspace`  | `root` (absolute), `name`, `key`, `preset` | `WorkspaceInfo`                       | `POST /workspaces`                              | none; `octo init [dir] --preset` |
| `list_plugins`   | none                                       | `PluginInfo[]`: id, name, description | `GET /plugins`                                  | `octo plugins list`              |
| `enable_plugin`  | `workspace`, `plugin`                      | the ids the workspace enables now     | `PUT /workspaces/:workspace/plugins/:plugin`    | `octo plugins enable <plugin>`   |
| `disable_plugin` | `workspace`, `plugin`                      | the ids the workspace enables now     | `DELETE /workspaces/:workspace/plugins/:plugin` | `octo plugins disable <plugin>`  |

- `preset` is `Schema.Literals` of the preset ids, and its description lists each preset with the
  first sentence of its description, so an MCP agent sees the choices in the tool's schema.
- `enable_plugin` refuses an id octodo has no plugin for. `disable_plugin` takes out any id
  `config.json` lists, so it can remove a stale one that is an `invalid-config` diagnostic, and
  refuses only an id that is neither installed nor listed. Both are idempotent and write
  `config.json` through `files.editConfig`, keeping its other keys.
- `PluginShared` has `name` and `description`, which `list_plugins` and workspace settings show.
- The CLI's `init` stays a command of its own: it defaults to the current directory and makes a
  relative one absolute before it calls `add_workspace`, which takes absolute folders only because
  the process that runs it may be a server with another working directory. It gains `--preset` and
  `--json`. `Connection.addWorkspace` and `Backend.addWorkspace` are gone; `octo init` calls
  `connection.run("add_workspace", ...)`.

## Why

- **Presets in the contract, not in `packages/plugins`.** The `preset` field's schema needs the ids,
  and the catalog is in the contract, which imports no plugin. The app's dialog needs the names and
  descriptions, and an import costs nothing where an endpoint would cost a request before the dialog
  can draw. A preset names its plugins by id, which is data; a test checks that every id is a plugin
  octodo has.
- **Adding a workspace is an operation.** 0015 already called it one in all but name. MCP is one of
  the places a preset is chosen, and the catalog is the only way an operation reaches MCP. As a
  catalog entry it is an MCP tool, an endpoint at the same path as before and a line of the skill,
  with no code of its own on any surface. Removing a workspace, reordering statuses and fix-all stay
  `app` endpoints: nothing here needs them on MCP, and each is its own decision.
- **Enable and disable, not a list to set.** A `set_plugins` taking the whole list makes a client
  read the list first and lose a change made in between, and its CLI form (`--enabled` as a boolean
  flag that defaults to false) would disable by omission. Two idempotent operations, one per
  intent, read the same in the app's switch, on the command line and to an agent.
- **`list_plugins` is an operation, not part of the snapshot.** What octodo has does not depend on
  a workspace, and an agent needs it before it can enable one. The snapshot keeps `plugins`, the
  enabled ids.

## Consequences

- Changing `PRESETS` never changes a workspace that exists.
- The app's add-workspace dialog shows the presets as choice cards under the name and key, Project
  selected. Workspace settings has a Plugins page with a switch per plugin; turning off one that has
  tasks asks first, since those tasks then read as plain tasks with an `unknown-kind` diagnostic
  until it is turned on again. The diagnostic's remedy says to enable the plugin there.
- A plugin's shared half must declare `name` and `description`; OCT-58's counter and OCT-59's
  anniversary need theirs when they merge.
- There is no `enable-plugin` fix for `unknown-kind`. Enabling from settings or the CLI covers it,
  and a fix-all that turned on a plugin a person had turned off would undo their choice.
- The app still creates plain tasks only. Creating a task of a kind from the app (recurring,
  counter, anniversary) is OCT-77, to be shaped once for every kind. Done in
  [0023](0023-plugins-contribute-their-create-fields-and-own-the-date-slot.md).
