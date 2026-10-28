# 0004. Packages split by dependency direction, not by domain

- Status: accepted
- Date: 2026-10-28

## Context

`@octodo/core` serves both the browser and the backend. The CLI imports `isReady` and
`taskSubtree` from it and runs domain rules itself. The web app copies rules such as `subtreeIds`
and `movedContainer` for its optimistic updates.

## Decision

Packages may depend only in one direction:

| Package    | Holds                                                                               | Imported by                                      |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `contract` | schemas, the operation catalog, `rules.ts` (pure functions)                         | everyone; the browser takes types and rules only |
| `engine`   | storage, tasks, lists, statuses, health, plugin registry, `Workspace`, `Workspaces` | server, client (embedded mode)                   |
| `plugins`  | first-party plugins, each with `shared`, `engine` and `web` entry points            | server, cli, mcp (`engine`), web (`web`)         |
| `server`   | HTTP API, MCP over HTTP, change feed, auth                                          | cli, desktop                                     |
| `client`   | typed client and `connect()`: a running server, or the engine in-process            | cli                                              |
| `cli`      | commands generated from the catalog                                                 |                                                  |

Tasks, lists and statuses stay folders inside `engine`. They share one storage layer, one snapshot
and one write lock, so separate packages would add build edges and version pins without isolating
anything. A lint rule forbids web and desktop renderer code from importing `engine`.

## Consequences

- `layout.ts` becomes `contract`'s `rules.ts`. It keeps only rules that must run per keystroke or
  per drag hover. Values the server can compute once (`ready`, `blocked`) go into the snapshot.
- What only the engine needs stays there (OCT-51): `layout.ts` keeps the on-disk grammar (file
  names, task id formats, folder names) and `place.ts` the order keys. Of `place.ts`, only
  `destination`, which the web's optimistic move needs, moved into `rules.ts`.
- A plugin's UI half cannot import its engine half. Shared types live in its `shared` entry.
- `plugins` depends on `engine`, not the reverse: a plugin's handlers need the engine's
  `Workspace`, and the processes hand the plugin list to the engine
  ([0014](0014-one-plugin-api-for-the-plain-task-and-every-plugin.md)).
