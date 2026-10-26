---
id: OCT-29
title: "File health: strict frontmatter checks with a fix for each problem"
priority: none
tags:
  - core
  - web
created: 2026-10-26T13:03:50.077Z
updated: 2026-10-26T13:03:50.077Z
order: a4
---

The app, CLI and MCP are the editors (see AGENTS.md). Sync tools (iCloud conflict copies, git merges) and stray hand edits can still break a file. octodo should read files strictly, say exactly what is wrong, and say how to fix it.

- Decode frontmatter through the domain schemas and turn every failure into a diagnostic. Each diagnostic names the file, the field and the reason. Today `Diagnostic` is `{ path, message }`; give it a field and a suggested fix, or a typed kind.
- Cover at least: YAML that doesn't parse, a missing or malformed `id`, a duplicate id (already reported, `workspace.ts:322`), an id key that doesn't match the workspace, unknown `priority`, bad `due`, a task file outside any status folder, and broken task links (OCT-27).
- Where the fix is mechanical and safe (a missing id, a stale link, a conflict copy), offer it as an action in the diagnostics dialog and in the CLI (`octo doctor`, name open). Never fix silently on read.
- A broken file never breaks the snapshot. The rest of the workspace loads.
- Update the wording in `packages/cli/src/skill.ts:39` ("Editing a file by hand also works") so it tells agents to use the CLI or MCP rather than editing files.

Depends on: OCT-27, for the broken-link check only. The rest can start at any time.
