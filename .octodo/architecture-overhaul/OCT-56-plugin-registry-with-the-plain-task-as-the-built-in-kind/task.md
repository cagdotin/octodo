---
id: OCT-56
title: Plugin registry, with the plain task as the built-in kind
status: todo
priority: high
tags:
  - architecture
  - plugins
created: 2026-10-28T07:40:11.229Z
order: aC
blocked_by: [OCT-51, OCT-52]
---

## Goal

Decision `docs/decisions/0007-first-party-plugins-per-workspace.md`.

## Scope

- A registry in the engine. A plugin declares: the frontmatter keys it owns (a versioned schema), the files it owns in a task folder (reserved names, no longer attachments), computed fields, operations (catalog entries), and validators (rows in `PROBLEMS`).
- The plain task is registered through the same API. If core can't use the API for its own task, the API is not ready.
- A task names its kind in frontmatter (`type: recurring`); no `type` means the plain task. An unknown or not-enabled kind loads as a plain task with a diagnostic.
- `config.json` gains `plugins: [...]`; only enabled plugins apply in a workspace.
- `@octodo/plugins` package with `shared`, `engine` and `web` entry points per plugin, so the web half never imports engine code. Registration conflicts (two plugins claiming one key or file) fail loudly.
- A file a plugin owns is never listed as an attachment, and `read_attachment` refuses it with the not-found error. The plugin exposes its content through computed fields or read-only operations (0011).
- UI: the app shows a plugin's fields and views only where it is enabled. Settle how a plugin's `web` entry plugs into the task panel and list rows.

## Done when

- The plain task goes through the registry with every existing test passing unchanged.
- A test plugin registered in a test proves keys, files, a computed field, an operation and a validator end to end, and that `read_attachment` refuses its owned file.
- `docs/architecture.md` describes the plugin API.

## From OCT-52

- An operation is a catalog entry (`Operation` in `packages/contract/src/catalog.ts`) plus a handler (`packages/engine/src/operations.ts`). Today both are static: `catalog` is one object, `handlers` is typed `{ [K in OperationName]: Handler<K> }`, and the MCP generator (`packages/mcp/src/index.ts`), the CLI generator (`packages/cli/src/commands.ts`) and the skill (`packages/cli/src/skill.ts`) each iterate `Object.entries(catalog)`.
- For plugins, make the catalog a value the registry hands out. Each generator takes `entries: Record<string, Operation>` and `runOperation` becomes `registry.run(name, input, open)`. A plugin's entries live in its `shared` entry point, since contract-level data must not import the engine. Its handlers live in its `engine` entry point and have the same `Handler` shape: `(workspace, input) => Effect`. Registration fails on a name another entry already has.
- Typing: the built-in entries keep their static types. A plugin's entries are typed in its own module, and the merged registry is `Record<string, Operation>` at runtime. `runOperation` already casts at that one boundary.
- Per-workspace enablement (0007) against a per-process tool list: MCP lists tools once per server, and the CLI builds commands at startup, so neither knows the workspace yet. Either list every installed plugin's operations and fail a call into a workspace that does not enable the plugin with a typed error, or use `McpServer`'s `EnabledWhen` annotation for MCP. The first keeps the contract test table simple.
- A plugin operation that answers with a file uses `success: FileSuccess`, and the MCP generator's `fileTools` handles it. A plugin-owned file must stay out of `storage/tree.ts`'s `readAttachments` listing; that one change also makes `read_attachment` refuse it with `AttachmentNotFound`.
- Adding an entry needs no other code: it shows up as an MCP tool, a CLI command when it has `cli` (a text renderer in `render.ts` is optional; without one the command prints JSON) and a skill line. Re-export `.agents/skills/octodo/SKILL.md` with `bin/octo skills export` (a test compares it). For a plugin, decide whether the exported skill lists only the operations of enabled plugins.
