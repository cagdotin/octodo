# Agent instructions

octodo is a local-first task manager. Every task is a markdown file with YAML frontmatter inside a
project's `.octodo/` folder, and the files are the source of truth. The app, the CLI and the MCP
server are the editors, for people and agents alike: every status change, move, rename and link
goes through them. The files are a portable format (plain markdown with custom properties) that
reads well and copies anywhere; matching another tool's behavior on them is not a goal. Sync tools
(iCloud, git) and stray hand edits still touch the files, so the app reads them strictly and
reports what is wrong instead of breaking. Long-term it competes with TickTick, Todoist and any.do
first, then Linear.

## The on-disk model

- `.octodo/config.json`: workspace `name`, id `key` (`HM` → ids `HM-1`, `HM-2`, ...) and `statuses`
  (id, display name, category). Categories have a fixed order (backlog, unstarted, started,
  completed, canceled, archived); the array only orders statuses within a category.
- `s<NN>-<id>/` folders are statuses, numbered in that workflow order. Changing a task's status
  moves its file; reordering statuses (workspace settings) renumbers every status folder.
- `l<NN>-<slug>/` folders are lists, nested up to three levels; each holds its own status folders.
  The number orders a list among its siblings (dense, renumbered on every move); folders without
  one sort last. Status folders directly in `.octodo/` hold tasks that are in no list.
- Numbers are never part of an id: a status is `todo`, a list is its slugs joined by `/`
  (`garden/seeds`). Reordering renames folders without changing ids; moving a list to another
  parent changes its id.
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
| `packages/cli`    | `octo` CLI on `effect/cli`; run it with `bin/octo`                                                                                     |
| `apps/web`        | Vite + React, TanStack Router/Query, shadcn/ui, XState                                                                                 |
| `apps/desktop`    | Electron shell: starts the server in the main process and opens the web app                                                            |
| `apps/site`       | Static landing page (plain HTML, no build); icons come from `brand/`                                                                   |
| `brand/`          | `glyph.svg` and `build.ts` (`pnpm brand`), which renders every icon, banner and social image                                           |

Decisions: Hono is the HTTP layer and Effect holds all logic. Use Effect's built-in modules where
they exist (`effect/ai` McpServer, `effect/cli`, `FileSystem`, `Schema`). The browser bundle imports
only types from `@octodo/core`, never Effect runtime code; `@octodo/core/layout` (plain functions,
no Effect) is the one runtime import it may use.

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
- `pnpm dev:site`: the landing page on 5530.
- `pnpm check`: format check, lint, typecheck, tests. Lefthook runs format, lint and typecheck on
  commit and `pnpm check` before push.
- Test against scratch folders (`OCTODO_HOME=<tmp> bin/octo ...`), never a real project's
  `.octodo/`.
- UI work: follow the `shadcn` skill in `.agents/skills/` (also visible as `.claude/skills`).
- Everything that scrolls in the web app goes through `ScrollArea` (`components/ui/scroll-area.tsx`),
  never `overflow-auto` or a hidden scrollbar; `apps/web/src/scrolling.test.ts` enforces it.
- The code is the documentation. A comment signals code that is too complicated or an edge case,
  so first try to make it unnecessary (better names, types, smaller functions). Public functions
  and schemas may get a one-line doc comment when their types don't say enough.
- Non-trivial work: the `octo-mode` skill picks a playbook and the principles behind it;
  `octo-help` maps the rest.
