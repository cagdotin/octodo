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
  statuses changes only this file.
- A folder with `task.md` is a task. Its frontmatter holds every attribute: `id`, `title`,
  `status`, `order` (fractional, among siblings), `priority`, `due`, `tags`, `created`. `updated`
  comes from the file's mtime; `list` and `parent` are never stored. Changing status is one write of
  `task.md`.
- A link is a frontmatter key holding a list of plain task ids, `blocked_by: [HM-3, HM-7]`;
  `LINK_KINDS` in `layout.ts` lists the keys. Only one end stores an edge: the reverse (`blocks`),
  `mentionedIn` (from `[[HM-3]]` in a body, outside code) and `blocked` are computed when a
  snapshot is read. A link field that is not a list of ids, a task's link to itself and an id no
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
  never changed.
- Of several task folders with one id, the task is the one a sync tool did not name as a copy
  (`HM-3-paint 2`), then the one named after its id and title, then the first read.
- A task's identity is the `id` in its frontmatter, never its path. Files without an id get one the
  first time they are read. Frontmatter keys the app does not manage are kept untouched, including
  order and comments (edits go through the `yaml` document API).
- Every new id is claimed first: creating `.octodo/.claim-<ID>` exclusively reserves it against the
  other processes on the machine (app, CLI, MCP), for a create, a file read without an id and a fix
  alike. A `.pending-id` file in a task folder names the id being written into its `task.md`, so
  readers racing on one new file agree on its id.
- Dot entries are octodo's own bookkeeping: claims, pending-id markers, `.*.tmp` files and `.new-*`
  folders. Scans, diagnostics and attachments never see them, and one more than a minute old is a
  crash's leftover, removed when a workspace opens.
- Every problem a read finds is a diagnostic `{ path, kind, field, message, fix }`, and every kind
  is a row of `PROBLEMS` in `diagnostics.ts` with its remedy and its fixes. A fix runs only when asked
  (`octo doctor`, the app's dialog, MCP `fix_diagnostic`) and only if a fresh read still offers that
  fix there, so repeating one changes nothing. Fix-all applies only fixes that cannot lose what a
  person wrote; one that guesses (making a loose file a task) is picked one at a time.
- Writes go to a temporary sibling and are renamed into place, so a crash or a reader never sees
  half a file; a new task or list folder is built under a dot name and renamed in. Writes go only
  into folders that exist: never `mkdir -p` a container (only `octo init` creates the folder it is asked to
  make a workspace). Any in-memory index is a cache that a file
  watcher invalidates.

## Layout

| Path              | What                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Effect v4 domain: schemas, markdown round-trip, folder rules, `Workspace` and `Workspaces` services                        |
| `packages/mcp`    | MCP toolkit and stdio/HTTP layers on Effect's `McpServer`                                                                  |
| `packages/server` | Hono HTTP API at `/api`, MCP at `/mcp`, SSE change feed, serves the built web app; `./client` is the typed Hono RPC client |
| `packages/cli`    | `octo` CLI on `effect/cli`; run it with `bin/octo`                                                                         |
| `apps/web`        | Vite + React, TanStack Router/Query, shadcn/ui, XState                                                                     |
| `apps/desktop`    | Electron shell: starts the server in the main process and opens the web app                                                |
| `apps/site`       | Static landing page (plain HTML, no build); icons come from `brand/`                                                       |
| `brand/`          | `glyph.svg` and `build.ts` (`pnpm brand`), which renders every icon, banner and social image                               |

Decisions: Hono is the HTTP layer and Effect holds all logic. Use Effect's built-in modules where
they exist (`effect/ai` McpServer, `effect/cli`, `FileSystem`, `Schema`). The browser bundle imports
only types from `@octodo/core`, never Effect runtime code; `@octodo/core/layout` (plain functions,
no Effect) is the one runtime import it may use.

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
- Everything that scrolls in the web app goes through `ScrollArea` (`components/ui/scroll-area.tsx`),
  never `overflow-auto` or a hidden scrollbar; `apps/web/src/scrolling.test.ts` enforces it.
- The code is the documentation. A comment signals code that is too complicated or an edge case,
  so first try to make it unnecessary (better names, types, smaller functions). Public functions
  and schemas may get a one-line doc comment when their types don't say enough.
- Non-trivial work: the `octo-mode` skill picks a playbook and the principles behind it;
  `octo-help` maps the rest.
