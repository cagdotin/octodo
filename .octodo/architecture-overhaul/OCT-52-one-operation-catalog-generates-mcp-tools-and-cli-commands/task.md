---
id: OCT-52
title: One operation catalog generates MCP tools and CLI commands
status: todo
priority: high
tags:
  - architecture
  - mcp
  - cli
created: 2026-10-28T07:39:48.186Z
order: a8
blocked_by: [OCT-51]
---

## Goal

Decision `docs/decisions/0005-one-operation-catalog.md`. Declare every operation once; stop hand-writing it in the server (`app.ts`), MCP (`packages/mcp/src/index.ts`) and CLI (`packages/cli/src/main.ts`).

## Scope

- Catalog entries in `@octodo/contract` as plain data: `name`, `description`, `readonly`, a flat `input` schema, `success`, `error`, and `http: { method, path, params }`.
- Generators: MCP tools (`Tool.make` takes the flat input), `effect/cli` commands, and the bundled agent skill (`packages/cli/src/skill.ts`).
- The CLI generator builds on `packages/cli/src/schema-flags.ts` (OCT-73): `schemaFlags(schema)` gives `params` plus `decode`, and `cli({ positional, ... })` annotates a field. Arrays take repeated flags or a comma list; a nullable field gets `--no-<name>`.
- Catalog entries carry the CLI annotations they need: positional fields, aliases, and descriptions (as schema annotations, so MCP and the skill read the same text). Name the module in 0005.
- CLI-only flags (`--output`, `--json`, the workspace selector) live outside the generated input, not in the catalog schema.
- Accept the CLI syntax changes the generator brings (for example `--no-due` instead of an empty value, `--tags a,b` or repeated `--tags`), and note them in the CLI help diff.
- Keep MCP-only output shapes (`TaskSummary`, `TaskDetail`, `list_tasks` filters, optional `workspace`) as catalog fields, not special cases.
- `read_attachment` is a catalog operation whose success is a file (0011). The HTTP generator emits the 0006 download endpoint. The MCP generator registers it through `McpServer.addTool` and returns `ImageContent` for PNG, JPEG, GIF and WebP, a text block for text, JSON and SVG, and otherwise an `EmbeddedResource` with a `file://` URI; a typed error above the upload limit. The CLI writes the bytes to stdout or `--output`.
- `get_task` lists `attachments: [{ path, size, mediaType }]`, with the media type from one engine lookup shared by every surface (0011).
- One contract test table runs every operation against every surface on a scratch workspace.
- Prototype sketch from the HttpApi research: see `docs/research/2026-10-architecture-survey.md`.

## Done when

- Adding an operation is one catalog entry plus its engine function.
- CLI output and MCP tool schemas are unchanged apart from the additions above (diff before and after on a scratch workspace with `OCTODO_HOME=<tmp> bin/octo ...`).
- Same checks as the rest of this list.

## From OCT-51

- Where things are now: `packages/contract` exports `.` = `src/domain.ts` (Effect schemas, inputs, tagged errors, the `Problem` type) and `./rules` = `src/rules.ts` (plain functions). Put the catalog in contract as a new file with its own export (say `./catalog`, at `src/catalog.ts`). Don't add it to `.`: the web may import only types from `.`, and lint (`.oxlintrc.json`) fails a value import of `@octodo/contract` in `apps/web/src/**` and `apps/desktop/src/preload.ts`. If the web is ever to read catalog values (descriptions, http paths for the client), the catalog must stay out of `domain.ts` and carry no Effect runtime the browser can't bundle, or the web keeps importing only its types.
- Lint on `packages/contract/src/**` forbids `node:*` and `@octodo/engine`, so a catalog entry can name its handler only by operation name. Bind name to handler in the engine (or in the generators): every handler is `(state: State, input) => Effect` in `packages/engine/src/{tasks,lists,statuses,health}/operations.ts` and `tasks/attachments.ts`, and `workspace.ts` maps each `Workspace` method to one.
- `@octodo/engine`'s `.` exports only `workspace.ts` and `workspaces.ts`. Consumers import schemas from `@octodo/contract`, rules from `@octodo/contract/rules`, and services from `@octodo/engine`. There is no re-export between them; keep it that way.
- The snapshot's `Task` now carries `ready` next to `blocked` (derived in `engine/src/tasks/links.ts` from `readiness()` in rules.ts). MCP `TaskSummary` has `ready` too. The CLI's `--ready` and MCP's `ready: true` filter on `task.ready`. A generated `list_tasks` should keep that filter as a catalog input field.
- The CLI and the sidebar decide "a note is not a problem" with `isProblem` from rules. `octo doctor`'s exit code and its "N problems and M notes" line depend on it.
- Behavior pin: `/private/tmp/claude-501/-Users-me-code-tasksmd/e42c17b3-8901-47f7-8bde-209e66e172d6/scratchpad/p51/pin51.sh <repo> <out>` extends OCT-50's pin with `octo list`/`--ready`/`show`, the HTTP snapshot and MCP stdio calls (list_tasks, get_task, list_diagnostics, get_workspace). Normalize with `norm.sh <out>` in the same folder (masks the run folder and log clocks, sorts the MCP replies). `final.n` there is the post-OCT-51 baseline.
