---
id: OCT-27
title: "Task links: ids in frontmatter, [[OCT-3]] mentions in the body"
tags:
  - core
created: 2026-10-26T13:03:32.391Z
order: a5
status: done
---

The basic piece every relation is built from. Parent and subtasks are not links: they come from the folder tree (OCT-40).

In frontmatter a link is a plain task id:

```yaml
blocked_by: [OCT-3, OCT-7]
```

- No wikilinks in frontmatter. An unquoted `[[...]]` is a nested list in YAML, and a bare id never goes stale when a task is renamed.
- In the body, `[[OCT-3]]` is a mention. Task detail shows "Mentioned in" on the target, and the editor renders the chip with the target's title.
- The `Task` schema clients see holds ids. The UI shows relations by title ("Blocked by OCT-3 Paint bedroom").
- Reverse relations (blocks, mentioned in) are computed when the snapshot is read and never stored. Each edge lives in one file only.
- An id that matches no task is a diagnostic. It doesn't make the read fail.
- Add a bullet to AGENTS.md's on-disk model describing the link format once this lands.

Depends on: OCT-40. Comes before OCT-28.
