# Architecture

This page explains which process and which package does what. It describes the code as it is today
and the target the Architecture overhaul list (in this repo's `.octodo/`) is moving to. Update the
"Today" sections as each step of the overhaul lands, and delete a "Target" section once it is true.

## Processes

### Today

Every surface opens `.octodo/` itself and runs its own copy of the engine and its cache:

- `octo <command>` runs the engine in-process for one command (`packages/cli/src/main.ts`).
- `octo mcp` runs the engine in-process with a file watcher and serves MCP over stdio.
- `octo serve` runs the HTTP server: the API at `/api`, MCP at `/mcp`, the change feed, the web app.
- The desktop app runs the same server inside Electron's main process (`apps/desktop/src/main.ts`).
  When `octo serve` already holds port 4520, it starts a second server on a random port.

Because several processes can write one workspace, every new id is claimed through
`.octodo/.claim-<ID>`.

### Target

```mermaid
flowchart LR
  web[Web app] -->|HTTP + SSE| srv
  desk[Desktop window] -->|HTTP + SSE| srv
  cli[octo CLI] -->|server.json found| srv
  mcp[MCP stdio] -->|server.json found| srv
  cli -.->|no server| eng[engine in-process]
  mcp -.->|no server| eng
  srv[octo server: HTTP API, MCP, engine, watcher] --> files[(.octodo/ files)]
  eng --> files
```

- One server per machine serves the web app, the desktop window and MCP over HTTP.
- The CLI and stdio MCP use it when `<home>/server.json` points at a live server, and run the
  engine in-process when there is none ([0002](decisions/0002-server-preferred-topology.md)).
- One process at a time holds a workspace's owner lock and writes
  ([0003](decisions/0003-one-writer-per-workspace.md)).
- The desktop app attaches to the server or spawns it as a child process.

## Packages

### Today

| Package           | What                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Effect domain: schemas, markdown round-trip, folder rules, `Workspace` and `Workspaces`. `storage/config.ts` is the one reader and writer of `config.json`, the first piece of the storage layer. `@octodo/core/layout` is plain functions the browser also imports. |
| `packages/mcp`    | MCP tools on Effect's `McpServer`, stdio and HTTP layers                                                                                                                                                                                                             |
| `packages/server` | Hono HTTP API, MCP mount, SSE change feed, static web app on 127.0.0.1; `./client` is the typed Hono RPC client                                                                                                                                                      |
| `packages/cli`    | `octo` on `effect/cli`                                                                                                                                                                                                                                               |
| `apps/web`        | Vite and React; imports types from core plus `@octodo/core/layout`                                                                                                                                                                                                   |
| `apps/desktop`    | Electron shell                                                                                                                                                                                                                                                       |

### Target

Packages depend in one direction: `contract` ← `engine` ← `server`, with `client` choosing between
the server and an embedded engine, and `plugins` split into `shared`, `engine` and `web` entries
([0004](decisions/0004-packages-by-dependency-direction.md)). Operations are declared once in
`contract` and the HTTP API, MCP tools and CLI commands are generated from them
([0005](decisions/0005-one-operation-catalog.md)). The HTTP layer is Effect HttpApi, and Hono is
deleted ([0006](decisions/0006-effect-httpapi-replaces-hono.md)).

## Extensibility

Task kinds are first-party plugins that each workspace enables in its `config.json`. The plain task
is the built-in kind, registered through the same API
([0007](decisions/0007-first-party-plugins-per-workspace.md)). Presets are data copied into a new
workspace's `config.json` ([0008](decisions/0008-statuses-per-workspace-presets-as-data.md)).
