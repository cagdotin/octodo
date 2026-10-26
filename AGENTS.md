# Agent instructions

tasksmd is a local-first task manager. Every task is a markdown file with YAML frontmatter inside a
project's `.tasks/` folder, and the files are the source of truth: the app, the CLI, the MCP server
and people editing files by hand all work on the same files. Long-term it competes with TickTick,
Todoist and any.do first, then Linear.

## The on-disk model

- `.tasks/config.json`: workspace `name`, id `key` (`CT` → ids `CT-1`, `CT-2`, ...), `statuses`
  (order, display name, category) and optional `listKinds`.
- `s-<status>/` folders are statuses. Changing a task's status moves its file.
- Folders whose prefix is a list kind (`c-` category, `p-` project by default) are lists; each holds
  its own status folders. Status folders directly in `.tasks/` hold tasks that are in no list.
- A task's identity is the `id` in its frontmatter, never its path. Files without an id get one the
  first time they are read. Frontmatter keys the app does not manage are kept untouched, including
  order and comments (edits go through the `yaml` document API).
- Writes go to a temporary sibling and are renamed into place, so sync tools (iCloud, git) never see
  half a file. Any in-memory index is a cache that a file watcher invalidates.

## Layout

| Path              | What                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Effect v4 domain: schemas, markdown round-trip, folder rules, `Workspace` and `Workspaces` services                                    |
| `packages/mcp`    | MCP toolkit and stdio/HTTP layers on Effect's `McpServer`                                                                              |
| `packages/server` | Hono HTTP API at `/api`, MCP at `/mcp`, SSE change feed, token auth, serves the built web app; `./client` is the typed Hono RPC client |
| `packages/cli`    | `tasksmd` CLI on `effect/cli`; run it with `bin/tasksmd`                                                                               |
| `apps/web`        | Vite + React, TanStack Router/Query, shadcn/ui, XState                                                                                 |
| `apps/desktop`    | Electron shell: starts the server in the main process and opens the web app                                                            |

Decisions: Hono is the HTTP layer and Effect holds all logic. Use Effect's built-in modules where
they exist (`effect/ai` McpServer, `effect/cli`, `FileSystem`, `Schema`). The browser bundle imports
only types from `@tasksmd/core`, never Effect runtime code.

## Security

The server binds to 127.0.0.1 by default. Every `/api` and `/mcp` request needs the token from
`<home>/server.json`, as `Authorization: Bearer` or the session cookie that `/api/pair` sets. A Host
allowlist (loopback, IP addresses, `--allow-host` names) blocks DNS rebinding, and cookie-carrying
writes from another origin are refused. Keep all three when changing the server: the same server is
meant to be reachable from a phone over Tailscale.

## Development

- Toolchain: `mise run setup` (Node 26, pnpm 12). Node runs the TypeScript sources directly, so
  keep to erasable syntax (no enums, namespaces or parameter properties) and import with `.ts`
  extensions.
- `pnpm dev`: Vite on 5520 plus Electron, with the server (127.0.0.1:4520) inside Electron.
- `pnpm dev:web`: API plus Vite, for the browser; open the pairing URL the API prints.
- `pnpm check`: format check, lint, typecheck, tests. Lefthook runs format, lint and typecheck on
  commit and `pnpm check` before push.
- Test against scratch folders (`TASKSMD_HOME=<tmp> bin/tasksmd ...`), never a real project's
  `.tasks/`.
- UI work: follow the `shadcn` skill in `.agents/skills/` (also visible as `.claude/skills`).
