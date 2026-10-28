# 0015. HTTP endpoints outside the catalog

- Status: accepted
- Date: 2026-10-28

## Context

OCT-53 generated the HTTP API from the operation catalog
([0005](0005-one-operation-catalog.md), [0006](0006-effect-httpapi-replaces-hono.md)). The web app
also needs endpoints that are not operations, and 0005 left open which of them become catalog
entries.

## Decision

`Api` in `@octodo/contract/api` has two groups. `operations` is generated from the catalog entries
by `operationsGroup(entries)`, the one function that reads them. `app` is declared by hand and
holds what is not an operation:

| Endpoint                                               | Why it is not an operation                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/health`                                      | describes the server: `{ version, capabilities }`                                      |
| `GET /api/connection`                                  | the server's own URLs, for the desktop's connect dialog                                |
| `GET /api/folders`                                     | browses the computer's folders to pick a new workspace root                            |
| `GET /api/workspaces/:workspace`                       | the snapshot the web app renders; agents read through `get_workspace` and `list_tasks` |
| `PUT /api/workspaces/:workspace/tasks/:id/files/:path` | the body is the file's bytes, which no flat input struct carries                       |
| `GET /api/events`                                      | the server-sent change feed                                                            |
| `POST /api/workspaces`                                 | adds a workspace; candidate for the catalog                                            |
| `DELETE /api/workspaces/:workspace`                    | removes a workspace, answers `{ removed }`; candidate for the catalog                  |
| `PUT /api/workspaces/:workspace/statuses/order`        | reorders statuses; candidate for the catalog                                           |
| `POST /api/workspaces/:workspace/diagnostics/fix-all`  | fix-all; candidate for the catalog                                                     |

The first six stay HTTP only. The last four are operations in all but name: they move into the
catalog, and so become MCP tools and CLI commands, once the plugin registry (OCT-56) settles how
entries are collected.

`capabilities` in `/api/health` names what this server offers (`operations`, `mcp`, `openapi`), so
a client that finds a running server (OCT-54) can tell what it may call before calling it.

## Consequences

- The catalog stays the list of what an agent or a person can do; the `app` group is the web app's
  plumbing. A new feature that a person can do is a catalog entry, not an `app` endpoint.
- The typed client covers both groups through `typeof Api`, so the web app does not see the split.
