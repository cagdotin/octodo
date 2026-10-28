---
id: OCT-69
title: Rethink security, remote access and authentication from first principles
status: backlog
priority: medium
tags:
  - security
  - server
  - decision
created: 2026-10-28T08:13:55.949Z
order: a4
---

## Why this exists

Decision `docs/decisions/0010-no-authentication-for-now.md` removed the token, pairing link, session cookie, `--allow-host` and both request guards (Host check, cross-origin write refusal): octodo runs only on one computer and nobody chose that design. Design security as one piece here, when it is needed.

## Questions

- Local first: other web pages in the same browser can reach the loopback server (DNS rebinding reads, cross-origin form posts). Is that worth guarding before any remote access exists?
- What is the actual remote need: a phone on the same tailnet, a second computer, a remote agent? Who is the attacker in each case?
- Does access belong in octodo at all, or in the network layer (Tailscale identity, `tailscale serve`)?
- If octodo does it: how is a device enrolled (one-time code, QR, link), what does it hold (per-device session, revocable), and how does a failed attempt look to a person on a phone?
- How do CLI, MCP, desktop and browser each get credentials without putting a long-lived secret in a URL, browser history or a launchd plist?
- How does it fit HttpApi security middleware (0006) and the server-preferred topology (0002)?

## Reference

executor (UsefulSoftwareCo/executor) does this well and is the starting point: a 0600 `server.json` manifest with a token, an unauthenticated `/api/health`, the desktop renderer receiving origin and token over IPC, and the token kept out of service files. Our survey notes are in `docs/research/2026-10-architecture-survey.md`. Read its code before designing. The removed implementation is in git before OCT-71's commit if a detail is useful.

## Deliverable

A decision record replacing 0010, then the implementation. Replaces the old OCT-2 (QR pairing), OCT-3 (per-device tokens) and OCT-11 (guard tests).
