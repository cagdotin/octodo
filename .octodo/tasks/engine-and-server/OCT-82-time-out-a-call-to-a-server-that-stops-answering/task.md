---
id: OCT-82
title: Time out a call to a server that stops answering
status: todo
priority: low
created: 2026-10-28T14:32:52.361Z
order: a3
---

After the probe, `send` in `packages/client/src/remote.ts` has no timeout, so a server that hangs mid-call hangs the CLI and `octo mcp` forever. Decision 0018 bounds only the probe.

Proposal from the review fix (OCT-61): a per-request timeout of about 30 s that stops at the response headers, so an attachment download is not cut off. It fails with ServerUnavailable ("does not answer within N s"). Decide the number from what the slowest legitimate call takes (a fix-all or a first scan of a large workspace).
