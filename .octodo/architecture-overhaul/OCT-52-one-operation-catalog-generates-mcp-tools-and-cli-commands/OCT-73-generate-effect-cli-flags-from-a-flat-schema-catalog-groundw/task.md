---
id: OCT-73
title: Generate effect/cli flags from a flat Schema (catalog groundwork)
status: todo
priority: medium
tags:
  - cli
  - architecture
created: 2026-10-28T10:37:29.251Z
order: a0
---

## Goal

The operation catalog (OCT-52, decision 0005) declares each operation's input as one flat `Schema.Struct`, and CLI commands are generated from it. Effect 4 has no Schema-to-flags generator (only `Flag.withSchema` per flag), so write one now, standalone, so OCT-52 only wires it.

## Scope

- A pure module (e.g. `packages/cli/src/flags.ts`) that turns a flat `Schema.Struct` into `effect/cli` flags and decodes the parsed flags back through the schema: strings, numbers, booleans, literals/enums (as choices), optional fields, nullable fields (a way to clear, e.g. `--due none`), arrays of strings (repeatable flag or comma list: pick one and say why), and a field marked positional (the task id, the title).
- Descriptions from schema annotations become flag help.
- Decoding errors are the schema's own messages, surfaced as CLI errors.
- Tests against the current domain inputs (create task, update task, move task, list filters) showing the generated flags parse what `octo` accepts today; document every difference from today's CLI syntax.

## Not in scope

Changing the real CLI commands; that is OCT-52.

## Done when

- The module and its tests are in, `pnpm check` passes.
- A short note in the report on what OCT-52 needs from catalog entries for this to work (e.g. a positional annotation).
