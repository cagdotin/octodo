---
id: OCT-71
title: Remove authentication, pairing and remote hosts from the server and clients
status: todo
priority: high
tags:
  - server
  - security
  - subtract
created: 2026-10-28T08:17:25.197Z
order: aN
---

## Goal

Decision `docs/decisions/0010-no-authentication-for-now.md`. Subtract before the HttpApi switch, so OCT-53 never ports auth.

## Scope

- Server: delete the token (`loadToken`, `tokenMatches`, `requireToken`), the pairing routes (`GET`/`POST /pair`), the session cookie, `pairUrl` and `--allow-host`/`--host`. Bind loopback only. Keep the Host check (loopback names only now; no IP literals, no allow list, no `*`) and the cross-origin write refusal, now applied to every non-GET request regardless of credentials. `/mcp` keeps both guards.
- `server.json`: no token. Keep the file only if something still reads it; OCT-54 will add `url`, `pid`, `version`.
- CLI (`octo serve` and anything printing a pairing URL), desktop (`apps/desktop`), web (pairing screen, token handling in `apps/web/src/lib/api.ts`, any paste-token form): remove every trace. The web app opens straight into the workspace.
- Tests: delete auth tests; the remaining server tests pass. Do not write the OCT-11 guard tests here unless trivial; OCT-11 does that.
- Docs in the same commit: `AGENTS.md` Security section and Layout table, the `pnpm dev:web` line, `docs/vision.md` (token and Tailscale lines), `docs/architecture.md` (server row, "phone browser" in the diagram), 0002 (token in `server.json`, Tailscale), 0005 (pairing/session in HTTP-only endpoints), 0006 (the "Files and pairing are endpoints too" section: no auth middleware, no pairing endpoint; keep sandboxed attachments), and `.claude/skills/octo-mode/SKILL.md` "Verify on the real surface" lines about the bearer token and pairing URL.

## Done when

- `grep -riE "token|pair|cookie|allow-host"` over `packages apps` finds no auth remnant.
- `pnpm check` passes.
- `pnpm dev:web` opens the app with no pairing step; a curl write with `Origin: https://evil.example` gets 403 and one with `Host: evil.example` gets 403.
