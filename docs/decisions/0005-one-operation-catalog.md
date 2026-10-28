# 0005. One operation catalog generates the HTTP API, MCP tools and CLI commands

- Status: accepted
- Date: 2026-10-28

## Context

The HTTP routes (`packages/server/src/app.ts`), the MCP tools and the CLI commands were written by
hand. Every new operation touched all three, and they drifted. herdr declares each operation once
and generates its API, CLI flags and JSON Schema from that declaration, with a test that they agree.

## Decision

- Each operation is declared once in `contract` as plain data: name, description, whether it only
  reads, a flat input schema, success and error schemas, and its HTTP method, path and which input
  fields are path parameters.
- Three generators read the catalog: HTTP endpoints, MCP tools (`Tool.make` takes the flat input)
  and `effect/cli` commands. The Schema-to-flags generator is octodo code, since effect has none.
- HTTP-only endpoints (connection info, folders, the change feed, attachment upload) stay
  hand-written in their own group. Attachment download is the catalog operation `read_attachment`,
  whose success is a file ([0011](0011-attachments-are-one-operation-plugin-files-are-private.md)).
- One contract test table runs every operation against every surface.
- The bundled agent skill is generated from the catalog.

## Shape

- The catalog is `packages/contract/src/catalog.ts`, exported as `@octodo/contract/catalog`. It is
  not in `@octodo/contract`'s main entry, so the browser, which imports only types from there,
  never bundles it.
- `catalog` is an object keyed by operation name, in the order the CLI skill lists them (MCP lists
  the file operations after the others, since it registers them on their own). Each entry is
  an `Operation`: `description`, `readonly`, optional `destructive` and `idempotent` (the MCP
  hints), `input` (one `Schema.Struct`), `success` (a schema, or `FileSuccess` for an operation
  that answers with a file's bytes), `error` (the union of tagged errors it can fail with),
  `http: { method, path }`, and an optional `cli`.
- An input field named `workspace` makes the operation run in one workspace. Each surface picks it
  its own way: MCP from the field or the server's working directory, the CLI from `--workspace` or
  the current directory (the field is not a flag), HTTP from the path.
- `http.path` is relative to `/api`, and each `:name` segment is the input field `name`
  (`pathParams` lists them; a test checks each one is a field). The path holds the parameters, so
  the entry does not list them a second time. The other fields are the query of a `GET` and the
  body otherwise.
- `cli` holds what only the command line needs: the words that run the command (`lists create`
  is `["lists", "create"]`), its short description, aliases and examples. Field-level CLI details are schema
  annotations from `cli({ positional, alias, clear })`: a positional argument, a one-letter alias,
  and the help of the `--no-<name>` flag that clears a nullable field. Field descriptions are plain
  schema descriptions, so MCP, `--help` and the skill read the same text. An entry without `cli`
  has no command of its own; `octo doctor` covers `list_diagnostics` and `fix_diagnostic`.
- The engine binds each name to its function in `packages/engine/src/operations.ts`: `handlers`
  is typed from the catalog, so a missing handler, or one whose success or error does not match
  its entry, fails the typecheck. `runOperation(name, input, open)` runs one on decoded input, with
  `open` turning the `workspace` field into a workspace the way the surface picks one.
- Generators: `packages/mcp/src/index.ts` makes a `Toolkit` of every operation whose success is a
  value and registers a file operation through `McpServer.addTool`. `packages/cli/src/commands.ts`
  makes the commands, from `schema-flags.ts` (the flat-schema-to-flags generator), and
  `render.ts` holds the text each command prints without `--json`. `packages/cli/src/skill.ts`
  lists every operation with its command and its description's first sentence, and the examples.
  `operationsGroup(entries)` in `packages/contract/src/api.ts` makes an HttpApi endpoint of each
  entry, typed from the entry, and `packages/server/src/operations.ts` implements them all in one
  loop over `runOperation`, with the `workspace` path parameter naming a registered workspace.
- CLI-only flags stay out of the catalog: `--workspace`, `--json` (on a command with a text
  renderer) and `--output` (on a file operation).
- Tests: `packages/cli/test/surfaces.test.ts` runs a table of calls covering every operation on the
  engine, over MCP, over HTTP and through the CLI, each on its own scratch workspace, and asserts they give
  the same result, file or error. `packages/cli/test/catalog.test.ts` checks the HTTP paths and
  that `.agents/skills/octodo/SKILL.md` is what `octo skills export` writes.

## What the catalog holds today

The operations MCP, the CLI and HTTP share, plus `read_attachment`. `operationsGroup` in
`@octodo/contract/api` generates one HttpApi endpoint per entry (OCT-53), and
`packages/cli/test/surfaces.test.ts` runs every call over HTTP too. The HTTP endpoints that are not
operations, and the four of them (adding and removing a workspace, reordering statuses, fix-all)
that are to become catalog entries, are listed in [0015](0015-http-endpoints-outside-the-catalog.md).
The CLI commands that are not operations (`init`, `workspace remove`, `doctor`, `serve`, `mcp`,
`skills export`) stay CLI only.

## Consequences

- Adding an operation is one catalog entry and one engine handler. It appears as an MCP tool, a
  CLI command (when it has `cli`) and a skill line with no other code; a text renderer is optional.
- Plugins add operations by adding catalog entries. They appear on every surface with no extra
  code.
- Every surface gives an operation's own success
  ([0013](0013-every-surface-gives-the-operations-result.md)).
- The catalog sits next to the HTTP API definition. It is not the API definition itself: MCP takes
  one flat struct, HTTP splits it into path and body, and some operations exist on one surface
  only. See [0006](0006-effect-httpapi-replaces-hono.md).
