---
id: OCT-11
title: "Pin the server's security rules with HTTP-level tests before the HttpApi switch"
tags:
  - security
  - tests
created: 2026-10-25T17:45:00.869Z
order: a7V
status: todo
priority: high
---

## Goal

[[OCT-53]] replaces Hono with Effect HttpApi. Before it starts, pin today's security behavior with tests that talk plain HTTP to a running server, so the same tests run unchanged against both implementations.

## Cases

- No token: 401 on `/api/*` and `/mcp`. Bearer token: 200. Pairing cookie: 200.
- Host allowlist: a request with `Host: evil.example` gets 403 on an API path, on `/mcp` and on an unknown path. Loopback, IP addresses and `--allow-host` names pass.
- A write that carries the cookie from another `Origin` is refused; the same write from the server's own origin passes.
- The known gap, as a test that fails today: `Authorization: Bearer <wrong>` plus a valid cookie skips the origin check in `auth.ts` `requireToken`.
- `GET /api/pair?token=...&next=/` sets an `HttpOnly`, `SameSite=Strict` cookie and redirects; a wrong token does not.

## Done when

- The tests live in `packages/server/test`, use only `fetch` against a started server, and pass on today's Hono server (except the gap test, marked as expected to fail until OCT-53).
