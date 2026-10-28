---
id: OCT-69
title: Rethink remote access and authentication from first principles
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

Decision `docs/decisions/0010-no-authentication-for-now.md` removed the token, pairing link, session cookie and `--allow-host`: octodo runs on one computer and nobody chose that design. Come back here when octodo needs to be reached from another device (a phone, a second machine, an agent elsewhere).

## Questions

- What is the actual need: a phone on the same tailnet, a second computer, a remote agent? Who is the attacker in each case?
- Does access belong in octodo at all, or in the network layer (Tailscale identity, `tailscale serve`)?
- If octodo does it: how is a device enrolled (one-time code, QR, link), what does it hold (per-device session, revocable), and how does a failed attempt look to a person on a phone?
- How do CLI, MCP, desktop and browser each get credentials without putting a long-lived secret in a URL, browser history or a launchd plist?
- How does this fit the HttpApi security middleware (0006) and the server-preferred topology (0002)?

## Reference

executor (UsefulSoftwareCo/executor) does this well and is the starting point: a 0600 `server.json` manifest with a token, an unauthenticated `/api/health`, the desktop renderer receiving origin and token over IPC, and the token kept out of service files. Our survey notes are in `docs/research/2026-10-architecture-survey.md`. Read its code before designing.

## Deliverable

A decision record replacing 0010, then the implementation. Replaces the old OCT-2 (QR pairing) and OCT-3 (per-device tokens).
