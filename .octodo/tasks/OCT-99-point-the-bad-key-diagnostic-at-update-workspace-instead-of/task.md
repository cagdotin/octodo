---
id: OCT-99
title: Point the bad-key diagnostic at update_workspace instead of a hand edit
status: todo
tags:
  - engine
created: 2026-10-29T18:53:09.140Z
order: a0
---

The `invalid-config` diagnostic for a key that is not letters and digits (`keyProblem` in `packages/engine/src/storage/config.ts`) still tells people to set `key` in config.json and change each id by hand. `update_workspace` with a new `key` (decision 0030) now does that migration. The kind's shared remedy, "Fix config.json by hand", is appended to every `invalid-config` message, so rewording only the detail contradicts it. Decide whether the key problem gets its own kind or a remedy per problem, then point it at Settings > General or `octo workspace update --key <KEY>`. Update the expectation in `packages/engine/test/health.test.ts` ("refuses a key ids cannot use").
