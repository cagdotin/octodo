# Architecture survey, October 2026

On 2026-10-28 we studied six projects that ship a server, a CLI, a UI and some form of plugins, to
decide how octodo should be structured. Each was read from a shallow clone of its default branch.
Paths are relative to each repo. Line counts are `wc -l` measurements. This file keeps the findings
so that a later decision does not need the research rerun. The decisions it fed are in
[decisions/](../decisions/README.md).

## What each project does

| Project                                                  | Who owns state                                                 | CLI with no server                                                 | Shared with clients                                             | Extensions                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| [opencode](https://github.com/anomalyco/opencode)        | one per-user service over SQLite, elected through a fixed port | starts the service, or a private child tied to its stdin           | schema plus an Effect `HttpApi`; client generated, diffed in CI | in-process plugins that transform catalogs; key/value storage only |
| [executor](https://github.com/UsefulSoftwareCo/executor) | one daemon; an exclusive SQLite lock decides the owner         | the CLI binary is the server and spawns it                         | the same `HttpApi` value; the browser runs Effect               | `PluginSpec` with host-owned storage; "one open seam"              |
| [t3code](https://github.com/pingdotgg/t3code)            | a server child process, event-sourced SQLite                   | live server if reachable, else offline writes under the owner lock | contracts package and a shared client runtime                   | none at runtime; compiled-in drivers; branch on capabilities       |
| [bb](https://github.com/get-bb/bb)                       | server hub over SQLite, plus a daemon per machine              | pure client                                                        | server contract, SDK, domain types                              | large in-process plugin API; 39 bundled plugins                    |
| [herdr](https://github.com/herdrdev/herdr)               | the server owns the terminal sessions                          | fails with "server not running"                                    | one operation catalog generates API, CLI flags, JSON Schema     | manifest plus child processes; cannot add entity kinds             |
| [pi](https://github.com/earendil-works/pi)               | each process owns its session file                             | no server                                                          | not applicable                                                  | full-trust TypeScript extensions, about 40 events                  |

## Findings that shaped decisions

**A single owner works because nothing else writes the store.** Every project with one server owns
a SQLite file or in-process sessions. octodo's answer is [0001](../decisions/0001-octodo-is-the-only-writer.md):
octodo's clients are the only supported writers, and the reader reports anything else.

**Everyone kept a way to run without the server.** opencode has `--standalone` and an in-memory SDK
that runs the server's router with no listener. executor keeps an in-process SDK. t3code's
`t3 project` writes offline under the ownership lock: "An unreachable server may still be running;
never write behind it" (`apps/server/src/cli/project.ts:430`). This led to
[0002](../decisions/0002-server-preferred-topology.md).

**Server lifecycle is where the code goes.** About 9.8k lines of executor's CLI are daemon
lifecycle: spawn elections, stale pids, pids reused after a reboot, service install on three
operating systems. opencode spends about 800 lines on elections and version handoff. Pay for a
daemon only for what it buys.

**Discovery is a 0600 file plus an unauthenticated probe.** opencode's `service.json` and
executor's `server.json` hold `{url, pid, version, token}`. A health endpoint answers without the
token. opencode's service checks every 5 seconds that it still owns the file. t3code adds about 40
optional capability flags to its server descriptor, each with a note on what older peers do
without it.

**Ownership needs a lock the OS releases.** t3code uses an exclusive SQLite transaction on
`server-owner.sqlite` (`apps/server/src/serverOwnership.ts`). executor holds an exclusive lock on
`data.db.owner-lock` with `busy_timeout = 0`. Both are released even on SIGKILL. See
[0003](../decisions/0003-one-writer-per-workspace.md).

**Split by dependency direction.** opencode's rule (`AGENTS.md:2`): "Client runtime code may depend
on Schema and Protocol but never Core or Server." t3code splits packages per domain only where
there are many interchangeable implementations (10 agent providers, 6 git forges). See
[0004](../decisions/0004-packages-by-dependency-direction.md).

**Thin transports and one catalog.** t3code: an HTTP route, MCP tool or CLI command decodes input,
calls one service method and maps errors. herdr declares operations once (`define_operations!` in
`src/api/schema/operations.rs`) and a test asserts the catalog matches the wire. See
[0005](../decisions/0005-one-operation-catalog.md).

**Plugins rarely add data types, and the core is never tiny.** pi's agent loop is about 2.5k lines
in a 76k-line host. bb's core is about 96k lines, herdr's about 291k. executor's `vision.md:70`:
"do not make 'everything a plugin.' Keep first-party capabilities first-party, and keep exactly one
open seam." bb (`AGENTS.md:30`): "A plugin API that performs a core action must be the path core
uses for that action." pi's newer packages store the extension's name in the data and treat a
missing extension as a diagnostic. See [0007](../decisions/0007-first-party-plugins-per-workspace.md).

**Presets are data.** opencode and pi treat presets as merged JSON. See
[0008](../decisions/0008-statuses-per-workspace-presets-as-data.md).

**Change feeds carry a sequence.** t3code and opencode send a snapshot with a sequence number and
drop events at or below it, so a reconnecting client can resume. opencode gives each SSE connection
a bounded queue (4,096 frames) and drops only the slow client. Not decided for octodo yet.

**Automations as processes.** herdr runs a plugin hook as a command line with context in
environment variables (`HERDR_PLUGIN_EVENT_JSON`), caps its output at 64 KiB, runs at most 32 at
once and keeps the last 200 run logs (`src/app/api/plugins/runtime.rs`). This is the model the
Open ideas list keeps for automations.

**Agents extend products through docs and a bundled skill.** pi's system prompt points at its own
docs and 80 examples. herdr prints a bundled `SKILL.md` with `herdr --skill`. bb generates a skill
listing the enabled plugins' commands.

## Effect HttpApi prototype

On 2026-10-28 a prototype against effect 4.0.6 tested whether `effect/http-api` can replace Hono.
It fed [0006](../decisions/0006-effect-httpapi-replaces-hono.md).

Every server feature mapped and was exercised against a running server:

| Feature                                  | HttpApi                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| bearer token or pairing cookie           | one `HttpApiMiddleware.Service` with ordered security schemes     |
| refuse cookie writes from another origin | inside the cookie handler, which reads `HttpServerRequest`        |
| `/api/pair` cookie                       | `HttpApiBuilder.securitySetCookie`                                |
| Host allowlist                           | global `HttpRouter.middleware`, covers unmatched paths and `/mcp` |
| typed errors                             | `httpApiStatus` annotation on `Schema.TaggedError`                |
| change feed                              | `HttpApiSchema.StreamSse`, released on client disconnect          |
| attachment upload, 20 MB limit           | `HttpApiSchema.StreamUint8Array({ maxBytes })`, 413 above it      |
| static app with route fallback           | `HttpStaticServer.layer({ root, spa: true })`                     |
| MCP                                      | `packages/mcp`'s `httpLayer` is already an `HttpRouter` layer     |
| OpenAPI                                  | `HttpApiBuilder.layer(api, { openapiPath })`                      |

Browser client sizes, from esbuild with `--minify`, then `gzip -9`, for the same two calls:

| Client                                             | gzip   |
| -------------------------------------------------- | ------ |
| typed `fetch` from `typeof Api`, no Effect runtime | 0.6 KB |
| Hono RPC (`hc`)                                    | 2.2 KB |
| Effect `HttpApiClient` plus `FetchHttpClient`      | 124 KB |
| floor: `Schema` decode of one `Task`               | 112 KB |

The web build was 420 KB gzipped at the time, so Effect's client would add about 29%.

Friction found: the error body becomes `{ _tag, ...fields }` because `message` is a getter; a body
validation error returns 400 with an empty body unless `layerSchemaErrorTransform` is added; Effect's
Node server, like Hono's, holds SSE headers until the first event, so the stream should emit on open.
Estimated migration: 8 to 10 files, under 1,000 lines.
