---
id: OCT-56
title: Plugin registry, with the plain task as the built-in kind
status: todo
priority: high
tags:
  - architecture
  - plugins
created: 2026-10-28T07:40:11.229Z
order: aC
blocked_by: [OCT-51, OCT-52, OCT-70]
---

## Goal

Decision `docs/decisions/0007-first-party-plugins-per-workspace.md`.

## Scope

- A registry in the engine. A plugin declares: the frontmatter keys it owns (a versioned schema), the files it owns in a task folder (reserved names, no longer attachments), computed fields, operations (catalog entries), and validators (rows in `PROBLEMS`).
- The plain task is registered through the same API. If core can't use the API for its own task, the API is not ready.
- A task names its kind in frontmatter (`type: recurring`); no `type` means the plain task. An unknown or not-enabled kind loads as a plain task with a diagnostic.
- `config.json` gains `plugins: [...]`; only enabled plugins apply in a workspace.
- `@octodo/plugins` package with `shared`, `engine` and `web` entry points per plugin, so the web half never imports engine code. Registration conflicts (two plugins claiming one key or file) fail loudly.
- UI: the app shows a plugin's fields and views only where it is enabled. Settle how a plugin's `web` entry plugs into the task panel and list rows.

## Done when

- The plain task goes through the registry with every existing test passing unchanged.
- A test plugin registered in a test proves keys, files, a computed field, an operation and a validator end to end.
- `docs/architecture.md` describes the plugin API.
