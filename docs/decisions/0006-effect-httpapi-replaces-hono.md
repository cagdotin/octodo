# 0006. Effect HttpApi replaces Hono

- Status: proposed (recommended; two open questions below)
- Date: 2026-10-28

## Context

Hono was chosen on 2026-10-25 because Effect's HTTP module seemed less suited. The owner prefers
one framework, and the engine is Effect already. A prototype against effect 4.0.6 checked every
feature the server uses ([survey, HttpApi section](../research/2026-10-architecture-survey.md#effect-httpapi-prototype)).

## Decision

Replace Hono with `effect/http-api`, with these conditions:

1. Do it in the same stage as the operation catalog ([0005](0005-one-operation-catalog.md)), not as
   a separate rewrite.
2. Pin `effect` to an exact version. The HttpApi modules are marked `@stability unstable`.
3. The browser keeps the no-Effect-runtime rule. Its client is a small `fetch` wrapper typed from
   `typeof Api` with a type-only import (0.6 KB gzipped). Effect's `HttpApiClient` would add 124 KB
   gzipped, almost all of it `Schema`.

## Consequences

- `/api`, `/mcp` and the static web app share one router and one runtime. The `toWebHandler`
  bridge in `packages/server/src/index.ts` goes away.
- OpenAPI comes for free, for agents and other non-TypeScript clients.
- The typed-fetch client uses each schema's `Type` as the wire type. That holds while domain
  schemas have no transforms. `domain.ts` has none today.
- `auth.ts` `requireToken` skips the origin check when any `Authorization: Bearer` header comes
  with a valid cookie. Not exploitable without a CORS preflight the server never answers, but the
  migration closes it with ordered security handlers.

## Open questions

- The error body becomes `{ _tag, ...fields }` instead of `{ error: message }`. Accept it, or keep
  the old body through a transform?
- Should attachment download and `GET /pair` become HttpApi endpoints (listed in OpenAPI) or stay
  raw routes?
