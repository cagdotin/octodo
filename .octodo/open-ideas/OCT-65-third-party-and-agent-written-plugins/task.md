---
id: OCT-65
title: Third-party and agent-written plugins
status: backlog
tags:
  - idea
  - plugins
created: 2026-10-28T07:41:00.588Z
order: a1
---

## Not now

Decision `docs/decisions/0007-first-party-plugins-per-workspace.md`: octodo loads no plugin code it did not ship. Revisit only when someone other than us needs to write a plugin, or when we want agents to write plugins for us (the pi and bb "builds itself" idea).

## What it would take (from the 2026-10-28 survey)

- **Where code lives:** under `<home>`, never in `.octodo/`. A workspace shared through git or a sync tool that carries code would run that code on whoever opens it (pi gates this with project trust, `docs/security.md`).
- **Loading:** pi loads TypeScript with jiti, no build step; bb and opencode rewrite imports so plugins share the host's `effect` and UI libraries. All run in-process with full trust.
- **Staged registration:** commit a plugin's registrations only if its whole factory succeeds (pi `loader.ts`); roll back on a failed reload (bb).
- **Versioning:** an engine range per plugin (bb `bbPluginSdk: ">=0.6.88"`, herdr `min_herdr_version`).
- **Recovery:** a safe mode that disables every non-built-in plugin (bb `bb plugin safe-mode on`).
- **Agent authoring:** a docs pointer and runnable examples in the agent skill (pi ships 80 examples; bb ships `bb plugin new` and `bb plugin dev` with hot reload).
- **API governance:** bb marks every new extension point `experimental_` and lists it in an audit file until it is stable.

## Prerequisite

The first-party plugin registry ([[OCT-56]]) must be proven by several plugins first.
