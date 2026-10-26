---
id: OCT-27
title: "Task links: full-file-name wikilinks in frontmatter, parsed to ids"
priority: none
tags:
  - core
created: 2026-10-26T13:03:32.391Z
updated: 2026-10-26T13:03:32.391Z
order: a1
---

The basic piece every relation is built from. A link to a task is stored in the file as a wikilink with the target's full file name, without `.md`:

```yaml
parent: "[[OCT-12-redo-the-bedroom]]"
blocked_by: ["[[OCT-3-paint-bedroom]]"]
```

The quotes are required, because YAML reads an unquoted `[[...]]` as a nested list.

- The file stores links. The `Task` schema clients see holds parsed ids. The UI shows relations ("Blocked by OCT-3 Paint bedroom"), never the `[[...]]` text.
- Resolve a link by the id at the start of its text (`OCT-3-...` resolves to `OCT-3`), not by the file name. A link with a stale name still resolves.
- When octodo writes a link, it writes the target's current file name.
- Links in the body (`[[OCT-3-...]]` in the notes) become mentions: task detail shows "Mentioned in" on the target.
- Reverse relations (blocks, subtasks, mentioned in) are computed when the snapshot is read and are never stored. Each edge lives in one file only.
- A link whose id matches no task is a diagnostic. It doesn't make the read fail.
- Add a bullet to AGENTS.md's on-disk model describing the link format once this lands.

Depends on: nothing. Comes before blocked_by and OCT-13.
