# 0006. Effect HttpApi replaces Hono

- Status: accepted
- Date: 2026-10-28

## Context

Hono was chosen on 2026-10-25 because Effect's HTTP module seemed less suited. The owner prefers
one framework, and the engine is Effect already. A prototype against effect 4.0.6 checked every
feature the server uses ([survey, HttpApi section](../research/2026-10-architecture-survey.md#effect-httpapi-prototype)).

## Decision

Replace Hono with `effect/http-api` and delete Hono once nothing imports it, with these conditions:

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

## Errors

An error response carries the error's tag, every field it has and a readable message:
`{ "_tag": "TaskNotFound", "id": "OCT-9", "message": "No task OCT-9" }`. Each error is a
`Schema.TaggedError` with its HTTP status, so the body is the error itself. A client can branch
on `_tag`, and whoever reads it gets every detail the engine had. MCP tool errors and CLI messages
carry the same fields.

## Files and pairing are endpoints too

Attachment download and the pairing link are declared HttpApi endpoints, hand-written as
[0005](0005-one-operation-catalog.md) says, not raw `HttpRouter` routes. A handler may return an
`HttpServerResponse`, so neither needs a raw route to send file bytes, a redirect or a cookie.

- `GET /api/workspaces/:ws/tasks/:id/files/:path` sits behind the `Authorization` middleware.
  The browser's `<img src>` passes with the session cookie, and agents and native clients pass with
  the bearer token. A raw route gets no middleware at all, so it would need a second copy of the
  auth checks. The success schema is `HttpApiSchema.StreamUint8Array()`, so OpenAPI lists the route
  as binary with its typed 404 errors. The handler serves the file through `HttpStaticServer`,
  which sets the real content type and handles `Range`, `ETag` and `304`. It serves only paths that
  the engine lists as attachments of the task. Every response carries
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. A type that a browser
  could run as a page, such as HTML or SVG, is sent as `Content-Disposition: attachment`, because
  an attachment is served from the app's own origin with the user's cookie.
- `:path` is one percent-encoded segment (`images%2Fplan.png`), not a `*` wildcard. HttpApi writes
  a wildcard into OpenAPI as a literal `/*`, which a generated client cannot fill in. Upload uses
  the same path.
- `GET /api/pair?token=...&next=...` is in a group without the middleware, since it is the request
  that creates the session. Its query schema accepts only a same-origin `next` path, so the link
  cannot redirect to another site. The handler sets the cookie with
  `HttpApiBuilder.securitySetCookie(Authorization.security.cookie, ...)`, so the cookie name is
  declared once, and then returns a 302.
- The typed `fetch` client builds URLs for these routes and does not parse their bodies. The web
  app passes the URL to `<img src>`. A native client fetches it with the bearer header.
