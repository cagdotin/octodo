# 0002. Clients prefer a running server and embed the engine when there is none

- Status: accepted
- Date: 2026-10-28

## Context

Today every surface opens `.octodo/` itself. The CLI, `octo mcp`, `octo serve` and the desktop app
each run their own engine and cache, and the desktop app starts a second server on a random port
when `octo serve` already holds 4520. The other projects we studied
([survey](../research/2026-10-architecture-survey.md)) route their UIs through one server. Every one
that did so kept a way to run without it: opencode's standalone mode and in-memory SDK, executor's
in-process SDK, t3code's offline CLI writes.

## Decision

- One server process per machine serves the web app, the desktop window and the HTTP MCP endpoint.
- The CLI and the stdio MCP server find a running server through `<home>/server.json` and talk to
  it over HTTP.
- When no server is running, they run the same engine in-process. They never write behind a server
  they can see but cannot reach (t3code's rule).
- The desktop app attaches to a running server, or spawns one as a child process. It stops running
  the server inside Electron's main process.

## Consequences

- Each client has two paths, so a contract test runs every operation both ways.
- `server.json` gains `url`, `pid` and `version`. `/api/health` answers without a token and reports
  the version and capability flags.
- An always-on server for the phone (a launchd service) is not decided. It is a discovery task in
  the Architecture overhaul list. No native mobile app is planned. The phone uses the web app over
  Tailscale.
