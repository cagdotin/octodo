---
id: OCT-53
title: Replace Hono with Effect HttpApi, endpoints generated from the catalog
status: done
priority: medium
tags:
  - architecture
  - server
created: 2026-10-28T07:39:56.272Z
order: a9
blocked_by: [OCT-52, OCT-71]
---

## Goal

Decision `docs/decisions/0006-effect-httpapi-replaces-hono.md` (accepted). One router and one runtime for `/api`, `/mcp` and the web app, and Hono deleted. Evidence: the HttpApi section of `docs/research/2026-10-architecture-survey.md`; the endpoint prototype from OCT-68 is described in 0006. There is no authentication and there are no request guards to port (0010, removed in OCT-71). The server binds loopback only.

## Settled

- Error body: `{ _tag, ...fields, message }`, each error a `Schema.TaggedError` with its status (0006, Errors). MCP and CLI errors carry the same fields.
- Attachment download is an HttpApi endpoint with a percent-encoded `:path`, served through `HttpStaticServer` with `nosniff`, `CSP: sandbox` and page-like types as attachments (0006).

## Scope

- Pin `effect` to an exact version (the HttpApi modules are `@stability unstable`).
- Generate endpoints from the catalog; HTTP-only endpoints (folders, events, attachment upload and download) hand-written in one group.
- SSE: events-mode `StreamSse` with the `change` event name and the 25 s ping; emit on open so headers flush (then drop the Vite proxy workaround).
- Body-validation errors carry a message (`layerSchemaErrorTransform`). Attachment upload keeps the 20 MB limit (`StreamUint8Array({ maxBytes })`).
- `/api/health`: `version` and capability flags, each flag documented with what an older client does without it.
- Browser client: a typed `fetch` wrapper from `typeof Api` with a type-only import (measured 0.6 KB gzipped; Effect's `HttpApiClient` is 124 KB), plus a typed `urlFor` for routes whose bodies are not parsed. The web app's call sites may change to fit it.
- Drop `hono`, `@hono/node-server`, `@hono/standard-validator`. Desktop shutdown closes open SSE streams.

## Done when

- The server tests in `packages/server/test` pass, plus HTTP-level tests written first against today's server for the routes that move (so they run unchanged on both), plus a test that an HTML attachment is served as a sandboxed download.
- No package depends on Hono.
- `pnpm dev:web` and the desktop app work end to end.

## From OCT-52

- The catalog is `packages/contract/src/catalog.ts` (`@octodo/contract/catalog`); 0005's "Shape" section describes an entry. Each entry has `http: { method, path }` relative to `/api`. Every `:name` segment is the input field `name` (`pathParams(http)` lists them, and `packages/cli/test/catalog.test.ts` checks each one is a field). The other fields are the query of a `GET` and the JSON body otherwise. Paths use the field name `:workspace`, where Hono has `:ws`.
- `workspace` is optional in the input schema, because MCP falls back to the server's working directory. The HTTP generator must make every path parameter required, for example by rebuilding the struct from `input.fields` with the path fields made required.
- Run an operation with `runOperation(name, input, open)` from `@octodo/engine` on decoded input. For HTTP, `open` is `workspaces.get(id)` (registered ids only, as Hono does today). `entry.error` is a `Schema.Union` of the tagged errors; each needs its `httpApiStatus`. That covers the two new ones too: `AttachmentNotFound` (404) and `AttachmentTooLarge` (413 suits it).
- Today's Hono routes differ from the catalog's results. `GET` and `PATCH /tasks/:id` return a `Task`, where `get_task` and `update_task` give a `TaskDetail` (links as `{ id, title, status }`, plus `subtasks` and `attachments`). `DELETE /tasks/:id` returns `{ ok: true }`, where `delete_task` gives `{ deleted }`. `get_workspace` is at the new path `/workspaces/:workspace/overview`, because `GET /workspaces/:ws` stays the web's snapshot. `list_tasks` (`GET .../tasks`) and `list_diagnostics` (`GET .../diagnostics`) are new routes. Check what `apps/web/src/lib/api.ts` reads from each result before switching it.
- Not in the catalog yet: the snapshot, `PUT statuses/order`, `POST diagnostics/fix-all`, `POST`/`DELETE /workspaces`, plus folders, connection, events and upload. Decide each: an entry also becomes an MCP tool, and a CLI command when it has `cli` (`fix_all` would let `octo doctor --fix` and MCP share one operation; `add_workspace` and `remove_workspace` would cover `octo init` and `octo workspace remove`).
- `read_attachment`: `success: FileSuccess`. The engine's `ws.readAttachment` reads the bytes into memory, up to `MAX_ATTACHMENT_BYTES` (contract `rules.ts`). For the download endpoint, stream the file instead, through `HttpStaticServer` per 0006. Look the file up the way `readAttachment` does (path validation, then `ws.attachments(id)` as the authority), but without reading bytes. A small `Workspace` method that returns `{ path, size, mediaType, file }` would do. Today's Hono download still checks only `attachmentPath`, so it serves files the listing excludes (a file reached through an in-folder symlink, or one in a folder that holds `task.md`). The listing should decide.
- Errors: MCP still answers `{ error: message }` (the old `ToolFailure`), and the CLI prints the message. 0006's `{ _tag, ...fields, message }` on MCP would change every tool's error output, so decide it here, in the MCP generator (`packages/mcp/src/index.ts`, `toFailure`).
- The contract test table `packages/cli/test/surfaces.test.ts` has three surfaces (engine, MCP over HTTP, CLI in-process). Add an `http` surface there, and the table checks the generated routes against the other three.
- `read_attachment`'s route is `/workspaces/:workspace/tasks/:id/files/:path`, and `:path` is one percent-encoded segment (0006), so `images/plan.png` travels as `images%2Fplan.png`. Keep the generator from splitting it.
- `get_task` and `update_task` build their detail in `detail()` (`packages/engine/src/operations.ts`) from three reads (task, snapshot, attachments), so a write between them can show a mix. Reading once from one snapshot would make the HTTP result consistent too.
