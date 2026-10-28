# 0010. No authentication while octodo runs on one computer

- Status: accepted
- Date: 2026-10-28

## Context

The server had an access token in `<home>/server.json`, a pairing link that set a session cookie,
and `--allow-host` for reaching it over Tailscale. No one decided to build these; they came along
with the first server. The owner uses octodo on one computer and does not reach it from other
devices.

## Decision

Remove all of it: the token, the pairing link, the session cookie, remote hosts, and the request
guards (the Host check and the refusal of cross-origin writes). The server binds to loopback only
and cannot be bound elsewhere. Security is designed as one piece later, in OCT-69, from what remote
access actually needs.

## Consequences

- Clients need nothing but the URL. The server no longer writes `server.json`; OCT-54 brings it back
  as the discovery file with `url`, `pid` and `version` ([0002](0002-server-preferred-topology.md)).
- Effect's `McpServer.layerHttp` still refuses `/mcp` requests whose `Origin` it does not list. That
  is the library's check, not ours; no octodo client calls `/mcp` from a browser.
- Known and accepted: a web page open in the same browser can send requests to the local server.
  Without a Host check, a page that rebinds its domain to 127.0.0.1 can read tasks; without an
  origin check, a page can post a form that changes them. OCT-69 starts from this.
- Attachments that a browser could run as a page are still served sandboxed
  ([0006](0006-effect-httpapi-replaces-hono.md)). That is a response header, not a guard, and it
  keeps an uploaded HTML file from running as the app.
- Reaching octodo from a phone or another machine is not possible until access is redesigned in
  OCT-69, with executor's daemon as the reference implementation.
