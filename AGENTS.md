# Agent instructions

octodo is a local-first task manager. Every task is a folder holding a markdown file with YAML
frontmatter inside a project's `.octodo/` folder, and the files are the source of truth. The app,
the CLI and the MCP server are the editors, for people and agents alike: every status change, move,
rename and link goes through them. The files are a portable format (plain markdown with custom
properties) that reads well and copies anywhere; matching another tool's behavior on them is not a
goal. octodo's own clients are the only supported writers. A hand edit or a sync tool that breaks
the format is outside the contract: the app reads strictly and reports what is wrong as a
diagnostic, and does not try to repair, merge or reconcile it. Don't add code for outside writers
beyond that. Long-term it competes with TickTick, Todoist and any.do first, then Linear.

Decisions, the vision and the architecture live in `docs/` (start at `docs/README.md`). Record a
new decision in `docs/decisions/`, not in agent memory, and update the docs in the same commit as
the code they describe. Existing code is not a constraint: when it conflicts with the design in `docs/`,
open a task in the same list for a first-principles analysis against that design, and decide there
instead of keeping the code because it exists.

## The on-disk model

- `.octodo/config.json`: workspace `name`, id `key` (`HM` → ids `HM-1`, `HM-2`, ...) and `statuses`
  (id, display name, category). Categories have a fixed order (backlog, unstarted, started,
  completed, canceled, archived); the array only orders statuses within a category. Reordering
  statuses changes only this file. `plugins` lists the plugins the workspace enables. A new
  workspace copies its statuses and plugins from a preset (`PRESETS` in `contract/src/presets.ts`:
  Checklist, Project, Chores); `enable_plugin` and `disable_plugin` change `plugins` later
  ([0022](docs/decisions/0022-presets-in-the-contract-workspace-and-plugin-settings-are-operations.md)).
- A folder with `task.md` is a task. Its frontmatter holds every attribute: `id`, `title`,
  `status`, `order` (fractional, among siblings), `priority`, `due`, `tags`, `created`. `updated`
  comes from the file's mtime; `list` and `parent` are never stored. Changing status is one write of
  `task.md`. `type: recurring` makes it a task of an enabled plugin's kind, which owns more keys
  and files in its folder; no `type` is the plain task, and a `type` the workspace does not enable
  reads as a plain task with an `unknown-kind` diagnostic
  ([0014](docs/decisions/0014-one-plugin-api-for-the-plain-task-and-every-plugin.md)). A
  recurring task keeps its rule in `repeat` and one line per time it was done in `log.jsonl`;
  moving it into a completed status logs that line and leaves it in the first unstarted status
  ([0016](docs/decisions/0016-recurring-tasks-complete-in-place.md)).
- A link is a frontmatter key holding a list of plain task ids, `blocked_by: [HM-3, HM-7]`;
  `LINK_KINDS` in `contract/src/rules.ts` lists the keys. Only one end stores an edge: the reverse (`blocks`),
  `mentionedIn` (from `[[HM-3]]` in a body, outside code), `blocked` and `ready` (open and not
  blocked) are computed when a snapshot is read. A link field that is not a list of ids, a task's link to itself and an id no
  file on disk has are diagnostics (a blocker that is not read still blocks); deleting a task removes its id from other
  tasks' links, and body mentions stay as text.
- A task folder inside a task folder is a subtask, the same shape all the way down. Every other file
  in a task folder is an attachment of that task (`images/plan.png`).
- A folder with `list.md` (`name`, `order`; the body describes the list) is a list, nested up to
  three levels. `.octodo/` is the root list. A list id is its folder names joined by `/`
  (`garden/seeds`), so moving a list to another parent changes its id.
- Folder names carry no meaning for the scanner; they are for people: `<id>-<slug>` for a task, the
  slug for a list. Anything else (a loose `.md`, a folder with neither marker or both, a symlink,
  which is never followed) is a diagnostic. A loose `.md` without frontmatter is a note: reported,
  never changed. `engine/src/storage/tree.ts` is the one reader of this grammar: nothing else lists a folder
  in `.octodo/`, and the scan only parses what it read and never writes.
- Of several task folders with one id, the first one read is the task; each other one is a
  `duplicate-id` diagnostic, and its folder name means nothing (a sync tool's `HM-3-paint 2` too).
- A task's identity is the `id` in its frontmatter, never its path. Files without an id get one the
  first time they are read. Frontmatter keys the app does not manage are kept untouched, including
  order and comments (edits go through the `yaml` document API).
- One process at a time writes a workspace: every write holds the owner lock, an exclusive SQLite
  transaction on `.octodo/.owner-lock` (`storage/owner-lock.ts`) that the OS releases when its
  holder dies, even on SIGKILL. Another process waits for it (10 s) and then reports that another
  octodo is writing; reads need no lock. The holder assigns new ids from its own scan, for a
  create, a file read without an id and a fix alike. The lock's one row names the last holder, so
  a holder that finds another one had it since forgets its cache and reads the files again.
- Dot entries are octodo's own bookkeeping: the owner lock, `.*.tmp` files and `.new-*` folders.
  Scans, diagnostics and attachments never see them. The first time a process holds the lock, it
  removes the temporary ones, since no write that owns them can still be running.
- Every problem a read finds is a diagnostic `{ path, kind, field, message, fix }`, and every kind
  is a row of `PROBLEMS` in `engine/src/health/problems.ts` with its remedy and its fixes. A fix runs only when asked
  (`octo doctor`, the app's dialog, MCP `fix_diagnostic`) and only if a fresh read still offers that
  fix there, so repeating one changes nothing. Fix-all applies only fixes that cannot lose what a
  person wrote; one that guesses (making a loose file a task) is picked one at a time.
- Writes go to a temporary sibling and are renamed into place, so a crash or a reader never sees
  half a file; a new task or list folder is built under a dot name and renamed in. Writes go only
  into folders that exist: never `mkdir -p` a container (only `octo init` creates the folder it is asked to
  make a workspace). Any in-memory index is a cache that a file
  watcher invalidates.
- Only `packages/engine/src/storage/` touches the disk; lint fails a `FileSystem` or `node:fs`
  import anywhere else in the engine. Other code takes a `Storage` (`makeStorage(root)`) and changes
  files only in `storage.write((files, ids) => ...)`, which holds the owner lock and reports each
  touched path to the cache. A new id written into frontmatter is an `AssignedId` from `ids.next`
  ([0012](docs/decisions/0012-only-storage-touches-the-disk.md)).

## Layout

| Path                | What                                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contract` | What every client shares: Effect schemas and errors (`domain.ts`), the operation catalog (`catalog.ts`), the HTTP API (`api.ts`), its typed `fetch` client (`client.ts`), a plugin's shared shape (`plugin.ts`) and `rules.ts`, the plain rules the browser runs too               |
| `packages/engine`   | Effect v4 domain: storage, scan, markdown round-trip, folder grammar, tasks, lists, statuses, health, `Workspace(s)`                                                                                                                                                               |
| `packages/plugins`  | First-party plugins (`recurring`), each a folder with `shared`, `engine` and `web` halves; `plugins` is the list every process gives `Workspaces.layer`, `./web` the app's `webPlugins`; a web half uses `@octodo/ui` and a client typed from its own operations, never `apps/web` |
| `packages/mcp`      | MCP tools generated from the operation catalog, and stdio/HTTP layers on Effect's `McpServer`                                                                                                                                                                                      |
| `packages/server`   | Serves `makeApi` over the catalog and the plugins' operations on Effect HttpApi at `/api` (OpenAPI at `/api/openapi.json`), MCP at `/mcp`, the SSE change feed, the built web app, on one router                                                                                   |
| `packages/client`   | `connect()`: every CLI and stdio MCP call runs on the server `<home>/server.json` names, or on the engine in-process when none answers ([0018](docs/decisions/0018-connect-finds-the-server-through-server-json.md))                                                               |
| `packages/cli`      | `octo` CLI on `effect/cli`, its commands and the bundled agent skill generated from the catalog; run it with `bin/octo`                                                                                                                                                            |
| `packages/ui`       | The UI kit the app and the plugins' web halves share: shadcn components, `cn`, date labels, `styles.css` (design tokens, fonts); imports no octodo package                                                                                                                         |
| `apps/web`          | Vite + React, TanStack Router/Query, XState; its components come from `@octodo/ui`                                                                                                                                                                                                 |
| `apps/desktop`      | Electron shell: starts the server in the main process and opens the web app                                                                                                                                                                                                        |
| `apps/site`         | Static landing page (plain HTML, no build); icons come from `brand/`                                                                                                                                                                                                               |
| `brand/`            | `glyph.svg` and `build.ts` (`pnpm brand`), which renders every icon, banner and social image                                                                                                                                                                                       |

Decisions: Effect holds all logic, and Effect HttpApi is the HTTP layer
([0006](docs/decisions/0006-effect-httpapi-replaces-hono.md)). Use Effect's built-in modules where
they exist (`effect/ai` McpServer, `effect/cli`, `effect/http-api`, `FileSystem`, `Schema`); `effect` is
pinned to an exact version. Packages depend in one direction,
`contract` ← `engine` ← `plugins` ← `server` ([0004](docs/decisions/0004-packages-by-dependency-direction.md)),
and `ui` ← `plugins` ← `apps/web`: a plugin never imports the app
([0017](docs/decisions/0017-the-ui-kit-is-a-package-plugins-type-their-own-client.md)).
The browser bundle (`apps/web`, the desktop preload) never imports `@octodo/engine` or Effect at
runtime and imports only types from `@octodo/contract`; `@octodo/contract/rules` (plain functions), `@octodo/contract/presets` (plain data),
`@octodo/contract/client` (the `fetch` client, typed from `api.ts` through type-only imports) and
`@octodo/ui` are the octodo runtime imports it may use. A plugin's web half types its client from its own operations,
`createClient<ServedApi<typeof shared.operations>>`. Lint enforces it.

Every operation is one entry in `contract/src/catalog.ts` plus its handler in
`engine/src/operations.ts`; HTTP endpoints, MCP tools, CLI commands and the skill are generated from
it, so never write one by hand ([0005](docs/decisions/0005-one-operation-catalog.md)). A plugin's operations are
entries in its `shared` half and handlers in its `engine` half; `makeRegistry(plugins)` merges them
with the catalog and `registry.run` runs any of them. After changing an entry,
run `bin/octo skills export` to refresh `.agents/skills/octodo/SKILL.md` (a test compares them).

## Security

octodo is built on the assumption that it runs locally on one computer. The server binds to
127.0.0.1 and has no authentication or request guards
([0010](docs/decisions/0010-no-authentication-for-now.md)). Any security layer (authentication,
remote access, guards) is added later on top, as its own discovery task (OCT-69), and the core must
not be shaped around it. Anything that would expose the server beyond this computer waits for
OCT-69.

## Development

- Toolchain: `mise run setup` (Node 26, pnpm 12). Node runs the TypeScript sources directly, so
  keep to erasable syntax (no enums, namespaces or parameter properties) and import with `.ts`
  extensions.
- `pnpm dev`: Vite on 5520 plus Electron, with the server (127.0.0.1:4520) inside Electron.
- `pnpm dev:web`: API plus Vite, for the browser; open the URL the API prints.
- `pnpm dev:site`: the landing page on 5530.
- `pnpm check`: format check, lint, typecheck, tests. Lefthook runs format, lint and typecheck on
  commit and `pnpm check` before push.
- Test against scratch folders (`OCTODO_HOME=<tmp> bin/octo ...`), never a real project's
  `.octodo/`.
- UI work: follow the `shadcn` skill in `.agents/skills/` (also visible as `.claude/skills`).
  `shadcn add` run in `apps/web` writes into `packages/ui`.
- Everything that scrolls in the web app goes through `ScrollArea` (`@octodo/ui/components/scroll-area`),
  never `overflow-auto` or a hidden scrollbar; `apps/web/src/scrolling.test.ts` enforces it.
- The code is the documentation. A comment signals code that is too complicated or an edge case,
  so first try to make it unnecessary (better names, types, smaller functions). Public functions
  and schemas may get a one-line doc comment when their types don't say enough.
- Non-trivial work: the `octo-mode` skill picks a playbook and the principles behind it;
  `octo-help` maps the rest.
