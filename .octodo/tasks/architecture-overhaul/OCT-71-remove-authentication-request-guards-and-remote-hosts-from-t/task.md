---
id: OCT-71
title: Remove authentication, request guards and remote hosts from the server and clients
status: done
priority: high
tags:
  - server
  - security
  - subtract
created: 2026-10-28T08:17:25.197Z
order: aN
---

## Goal

Decision `docs/decisions/0010-no-authentication-for-now.md`. Subtract before the HttpApi switch, so OCT-53 never ports any of it.

## Scope

- Server: delete the token (`loadToken`, `tokenMatches`, `requireToken`), the pairing routes (`GET`/`POST /pair`), the session cookie, `pairUrl`, `--allow-host`/`--host`, the Host check (`hostGuard`) and the cross-origin write refusal. Bind loopback only. No request guards remain.
- `server.json`: no token. Keep the file only if something still reads it; OCT-54 will add `url`, `pid`, `version`.
- CLI (`octo serve` and anything printing a pairing URL), desktop (`apps/desktop`), web (pairing screen, token handling in `apps/web/src/lib/api.ts`, any paste-token form): remove every trace. The web app opens straight into the workspace.
- Tests: delete auth and guard tests; the remaining server tests pass.
- Docs in the same commit: `AGENTS.md` Security section (loopback only, no auth or guards, see 0010 and OCT-69) and Layout table, the `pnpm dev:web` line, `docs/vision.md` (token and Tailscale lines), `docs/architecture.md` (server row, "phone browser" in the diagram), 0002 (token in `server.json`, Tailscale), 0005 (pairing/session in HTTP-only endpoints), 0006 (the "Files and pairing are endpoints too" section: no auth middleware, no pairing endpoint; keep sandboxed attachments), and `.claude/skills/octo-mode/SKILL.md` "Verify on the real surface" lines about the bearer token, pairing URL and guards.

## Done when

- `grep -riE "token|pair|cookie|allow-host|hostGuard"` over `packages apps` finds no auth or guard remnant.
- `pnpm check` passes.
- `pnpm dev:web` opens the app with no pairing step, `/api` answers with no credentials, and the server is not reachable on a non-loopback address.
