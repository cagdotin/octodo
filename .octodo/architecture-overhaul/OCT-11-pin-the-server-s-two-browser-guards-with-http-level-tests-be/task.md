---
id: OCT-11
title: "Pin the server's two browser guards with HTTP-level tests before the HttpApi switch"
tags:
  - security
  - tests
created: 2026-10-25T17:45:00.869Z
order: a7V
status: todo
priority: high
blocked_by: [OCT-71]
---

## Goal

[[OCT-53]] replaces Hono with Effect HttpApi. Before it starts, pin the guards that decision 0010 keeps with tests that talk plain HTTP to a running server, so the same tests run unchanged against both implementations. There is no authentication to test (0010).

## Cases

- Host check: a request with `Host: evil.example` (or an IP that is not loopback) gets 403 on an API path, on `/mcp` and on an unknown path. `localhost`, `127.0.0.1` and `[::1]`, with any port, pass.
- Cross-origin writes: a POST, PATCH or DELETE with `Origin: https://evil.example` is refused with 403; the same write with the server's own origin, or with no `Origin` (CLI, curl), passes. A GET from another origin is answered without CORS headers.
- The server refuses to bind a non-loopback address.

## Done when

- The tests live in `packages/server/test`, use only `fetch` against a started server, and pass on the server after OCT-71.
