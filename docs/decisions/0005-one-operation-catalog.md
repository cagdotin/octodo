# 0005. One operation catalog generates the HTTP API, MCP tools and CLI commands

- Status: accepted
- Date: 2026-10-28

## Context

The HTTP routes (`packages/server/src/app.ts`), the MCP tools (`packages/mcp/src/index.ts`) and the
CLI commands (`packages/cli/src/main.ts`) are written by hand. Every new operation touches all
three, and they drift. herdr declares each operation once and generates its API, CLI flags and
JSON Schema from that declaration, with a test that they agree.

## Decision

- Each operation is declared once in `contract` as plain data: name, description, whether it only
  reads, a flat input schema, success and error schemas, and its HTTP method, path and which input
  fields are path parameters.
- Three generators read the catalog: HTTP endpoints, MCP tools (`Tool.make` takes the flat input)
  and `effect/cli` commands. The Schema-to-flags generator is octodo code, since effect has none.
- HTTP-only endpoints (connection info, folders, the change feed, attachment upload and download)
  stay hand-written in their own group.
- One contract test table runs every operation against every surface.
- The bundled agent skill (`packages/cli/src/skill.ts`) is generated from the catalog.

## Consequences

- Plugins add operations by adding catalog entries. They appear on every surface with no extra
  code.
- The catalog sits next to the HTTP API definition. It is not the API definition itself: MCP takes
  one flat struct, HTTP splits it into path and body, and some operations exist on one surface
  only. See [0006](0006-effect-httpapi-replaces-hono.md).
