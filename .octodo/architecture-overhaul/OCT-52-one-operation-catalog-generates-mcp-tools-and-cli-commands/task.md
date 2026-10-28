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
- Generators: MCP tools (`Tool.make` takes the flat input), `effect/cli` commands (write a Schema-to-flags generator; effect has none, only `Flag.withSchema` per flag), and the bundled agent skill (`packages/cli/src/skill.ts`).
- Keep MCP-only output shapes (`TaskSummary`, `TaskDetail`, `list_tasks` filters, optional `workspace`) as catalog fields, not special cases.
- `read_attachment` is a catalog operation whose success is a file (0011). The HTTP generator emits the 0006 download endpoint. The MCP generator registers it through `McpServer.addTool` and returns `ImageContent` for PNG, JPEG, GIF and WebP, a text block for text, JSON and SVG, and otherwise an `EmbeddedResource` with a `file://` URI; a typed error above the upload limit. The CLI writes the bytes to stdout or `--output`.
- `get_task` lists `attachments: [{ path, size, mediaType }]`, with the media type from one engine lookup shared by every surface (0011).
- One contract test table runs every operation against every surface on a scratch workspace.
- Prototype sketch from the HttpApi research: see `docs/research/2026-10-architecture-survey.md`.

## Done when

- Adding an operation is one catalog entry plus its engine function.
- CLI output and MCP tool schemas are unchanged apart from the additions above (diff before and after on a scratch workspace with `OCTODO_HOME=<tmp> bin/octo ...`).
- Same checks as the rest of this list.
