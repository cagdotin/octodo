---
id: OCT-101
title: Try pstack's /statechart skill to model and test octodo's state machines
status: backlog
priority: low
tags:
  - discovery
  - testing
created: 2026-10-29T19:37:45.654Z
order: a2
---

poteto announced that the `/statechart` skill in pstack v0.15.36 is stable. It's best combined with `/create-formal-verification-skill` to model state machines and distributed systems abstractly and find bugs. The skill includes a mini TLC compiler that parses and lowers to a small IR.

Try it on octodo, for example the sync between the files on disk, the server, and the UI, or task status and blocker transitions, and see whether it finds real bugs.

Source: [poteto's post](https://x.com/i/status/2115880102601101414). Requested in [this reply](https://x.com/i/status/2115890781454258457). Filed by Grok Bot for cagin.
