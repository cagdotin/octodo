---
id: OCT-68
title: "Decide from first principles: attachment download and pairing as HttpApi endpoints or raw routes"
status: done
priority: medium
tags:
  - architecture
  - server
  - decision
created: 2026-10-28T08:07:16.691Z
order: aK
---

## Question

Should attachment download (`GET .../tasks/:id/files/*`) and the pairing link (`GET /pair?token=...`) be declared HttpApi endpoints (typed, in OpenAPI, behind the same security middleware) or raw `HttpRouter` routes?

## Rule

Decide from the target design in `docs/` (server-preferred topology, operation catalog, plugins that own files, agents over MCP and OpenAPI, a possible future phone or native client), not from how today's web app calls them. Nothing in the current code is a constraint.

## Deliverable

- What each option means concretely in Effect 4 (declaration, auth, streaming a file body, redirects and Set-Cookie, OpenAPI output, the typed client).
- A recommendation with reasons, recorded as an update to `docs/decisions/0006-effect-httpapi-replaces-hono.md` (replace its open question).
- Prove the claims you rely on with a prototype in a scratch folder against the pinned effect version.

## Done when

0006 has no open question left and OCT-53 can start.
