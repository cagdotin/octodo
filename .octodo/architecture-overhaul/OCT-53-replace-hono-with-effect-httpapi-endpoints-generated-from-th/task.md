---
id: OCT-53
title: Replace Hono with Effect HttpApi, endpoints generated from the catalog
status: todo
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
