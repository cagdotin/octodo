# Agent instructions

octodo is a local-first task manager. Every task is a folder holding a markdown file with YAML
frontmatter inside a project's `.octodo/` folder, and the files are the source of truth. The app,
the CLI and the MCP server are the editors, for people and agents alike: every status change, move,
rename and link goes through them. The files are a portable format (plain markdown with custom
properties) that reads well and copies anywhere; matching another tool's behavior on them is not a
goal. Sync tools (iCloud, git) and stray hand edits still touch the files, so the app reads them
strictly and reports what is wrong instead of breaking. Long-term it competes with TickTick, Todoist
and any.do first, then Linear.

## The on-disk model

- `.octodo/config.json`: workspace `name`, id `key` (`HM` → ids `HM-1`, `HM-2`, ...) and `statuses`
  (id, display name, category). Categories have a fixed order (backlog, unstarted, started,
  completed, canceled, archived); the array only orders statuses within a category. Reordering
  statuses changes only this file.
- A folder with `task.md` is a task. Its frontmatter holds every attribute: `id`, `title`,
  `status`, `order` (fractional, among siblings), `priority`, `due`, `tags`, `created`. `updated`
  comes from the file's mtime; `list` and `parent` are never stored. Changing status is one write of
  `task.md`.
- A link is a frontmatter key holding a list of plain task ids, `blocked_by: [HM-3, HM-7]`;
  `LINK_KINDS` in `layout.ts` lists the keys. Only one end stores an edge: the reverse (`blocks`),
  `mentionedIn` (from `[[HM-3]]` in a body, outside code) and `blocked` are computed when a
  snapshot is read. A link field that is not a list of ids, a task's link to itself and an unknown
  id are diagnostics (an unknown blocker still blocks); deleting a task removes its id from other
  tasks' links, and body mentions stay as text.
- A task folder inside a task folder is a subtask, the same shape all the way down. Every other file
  in a task folder is an attachment of that task (`images/plan.png`).
- A folder with `list.md` (`name`, `order`; the body describes the list) is a list, nested up to
  three levels. `.octodo/` is the root list. A list id is its folder names joined by `/`
  (`garden/seeds`), so moving a list to another parent changes its id.
- Folder names carry no meaning for the scanner; they are for people: `<id>-<slug>` for a task, the
  slug for a list. Anything else (a loose `.md`, a folder with neither marker or both) is a
  diagnostic, and so is a workspace in the old folder layout, which `octo migrate` converts.
- A task's identity is the `id` in its frontmatter, never its path. Files without an id get one the
  first time they are read. Frontmatter keys the app does not manage are kept untouched, including
  order and comments (edits go through the `yaml` document API).
- Every new id is claimed first: creating `.octodo/.claim-<ID>` exclusively reserves it against the
  other processes on the machine (app, CLI, MCP), for a create, a file read without an id and a fix
  alike. A `.pending-id` file in a task folder names the id being written into its `task.md`, so
  readers racing on one new file agree on its id.
- Dot entries are octodo's own bookkeeping: claims, pending-id markers, `.*.tmp` files and `.new-*`
  or `.migrate-*` folders. Scans, diagnostics and attachments never see them, and one more than a
  minute old is a crash's leftover, removed when a workspace opens.
- Every problem a read finds is a diagnostic `{ path, kind, field, message, fix }`, and every kind
  is a row of `PROBLEMS` in `diagnostics.ts` with its remedy and its fixes. A fix runs only when asked
  (`octo doctor --fix`, the app's dialog, MCP `fix_diagnostic`) and only if a fresh read still finds
  the problem, so repeating one changes nothing.
- Writes go to a temporary sibling and are renamed into place, so sync tools (iCloud, git) never see
  half a file; a new task or list folder is built under a dot name and renamed in. Writes go only
  into folders that exist: never `mkdir -p` a container. Any in-memory index is a cache that a file
  watcher invalidates.

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
