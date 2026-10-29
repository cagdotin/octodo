# 0030. One `update_workspace` changes a workspace's name, description and key, and a new key rewrites every id

- Status: accepted
- Date: 2026-10-29

## Context

A workspace's `name` and id `key` live in `config.json`, and the app's General settings told people
to edit them there. Renaming the folder does not rename the workspace: removing it from octodo and
adding the folder again registers it as it is ([0022](0022-presets-in-the-contract-workspace-and-plugin-settings-are-operations.md)),
so it keeps the old name. Editing `key` by hand is worse. Every id with the old key then reads as
an id from another workspace, links and `[[HM-3]]` mentions keep the old ids, and new ids count
from 1 again, so `HM-3` and a new `OCT-3` can both exist. A workspace also had nowhere to say what
it is for.

## Decision

| Operation          | Input                                        | Success         | HTTP                           | CLI                                                                         |
| ------------------ | -------------------------------------------- | --------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `update_workspace` | `workspace`, `name?`, `description?`, `key?` | `WorkspaceInfo` | `PATCH /workspaces/:workspace` | `octo workspace update [--name] [--description] [--no-description] [--key]` |

- `config.json` gains an optional `description`, and `WorkspaceInfo` (so the snapshot and
  `list_workspaces`) gives it when it is set. Null or blank removes the key.
- A field left out stays as it is. The name is trimmed and cannot be blank.
- A `key` that differs from the current one keeps every number and swaps the key: `HM-3` becomes
  `OCT-3` in the `id` of every task, list and entry file (in every section, enabled or not), in
  each link field (`blocked_by`), in `[[HM-3]]` mentions outside code, and at the start of task and
  entry folder names. The same key as now rewrites nothing.
- `config.json` is written once, last, with every field that changed.
- A key change is refused, before anything is written, while a marker file's frontmatter does not
  read, and when an id with the new key and the same number is already on disk.
- The app's General settings edits the name and the description in place, each saved on blur or
  Enter. The key field enables a Change button whose dialog says what gets rewritten; the key
  changes only on confirm.

## Why

- **One operation, typed per field.** Name, description and key are all what `config.json` says
  about the workspace, so one partial update reads like `update_task` to a person, a script and an
  agent. Each field keeps its own schema, so an agent sees the key's format in the tool's schema
  instead of a free-form map that is checked by hand.
- **The key goes last.** Until `config.json` names the new key, new ids count from the old key's
  numbers, so a run that stopped halfway cannot hand out an id that clashes with one it already
  moved. Running it again finds only the files still on the old key and finishes them.
- **Mentions in code stay.** A code span or block is text someone wrote on purpose, as the scan
  already treats it: a mention there is not a mention. A bare `HM-3` in prose is left too, since
  only `[[HM-3]]` is octodo's syntax.

## Consequences

- The cost of a call depends on its fields: a name or a description is one write, a key rewrites
  every task. The operation's description says so, and the app asks before a key change.
- Anything outside the workspace that names the old ids (commit messages, notes elsewhere, links in
  another workspace) keeps them. The dialog says so.
