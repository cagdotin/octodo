---
id: OCT-70
title: Decide how agents and clients read plugin-owned files and attachment bytes
status: todo
priority: low
tags:
  - architecture
  - plugins
  - mcp
  - decision
created: 2026-10-28T08:13:59.176Z
order: aM
---

## Gaps found in OCT-68

- 0007 says files a plugin owns (`log.jsonl` for recurring tasks) are not attachments, so the download endpoint returns 404 for them. Nothing says whether any client may read them, or only through the plugin's own operations.
- 0005 makes attachment download HTTP-only, so an agent on MCP has no way to read an attachment's bytes (an image it was asked to look at). Options include an MCP resource per attachment or a catalog operation returning bytes.

## Deliverable

A first-principles answer against the target design, recorded in 0005 or 0007 (or a new decision), before OCT-56 (plugin registry) lands.
