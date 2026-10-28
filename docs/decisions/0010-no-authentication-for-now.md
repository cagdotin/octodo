# 0010. No authentication while octodo runs on one computer

- Status: accepted
- Date: 2026-10-28

## Context

The server had an access token in `<home>/server.json`, a pairing link that set a session cookie,
and `--allow-host` for reaching it over Tailscale. No one decided to build these; they came along
with the first server. The owner uses octodo on one computer and does not reach it from other
devices.

## Decision

Remove authentication: the token, the pairing link, the session cookie and remote hosts. The server
binds to loopback only and cannot be bound elsewhere.

Keep two checks, because they guard against web pages in the user's own browser, not against other
people, and they cost a few lines with no UI:

- **Host check.** A request whose `Host` is not a loopback name (`localhost`, `127.0.0.1`, `[::1]`)
  is refused. Without it, a page can rebind its own domain to 127.0.0.1 and read every task.
- **Cross-origin writes.** A non-GET request whose `Origin` is not the server's own origin is
  refused. Without it, any page can send a form post that changes or deletes tasks.

## Consequences

- Clients need nothing but the URL. `server.json` stays as the discovery file
  ([0002](0002-server-preferred-topology.md)) without a token.
- Attachment download and every other route need no credentials, so an attachment that a browser
  could run as a page is still served sandboxed ([0006](0006-effect-httpapi-replaces-hono.md)): it
  is same-origin with the API.
- Reaching octodo from a phone or another machine is not possible until access is redesigned.
  OCT-69 holds that work, with executor's daemon as the reference implementation.
