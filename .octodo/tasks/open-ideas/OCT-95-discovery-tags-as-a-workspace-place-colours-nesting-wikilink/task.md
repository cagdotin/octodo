---
id: OCT-95
title: "Discovery: tags as a workspace place (colours, nesting, wikilinks)"
status: backlog
priority: medium
tags:
  - discovery
  - tags
created: 2026-10-29T14:48:31.298Z
order: a9
---

## Not decided

Do not build this yet. Rethink how tags are stored, configured, shown and filtered, and decide whether this is a plugin (decision 0027 lets a plugin add a section).

## Today

A task's tags are a list of words in its frontmatter (`tags: [diy, walls]`); a field that is not a list of words is an `invalid-tags` diagnostic. `list_tasks` and the app's Filter menu filter by one tag. Tags exist only on tasks: there is no place to see every tag in a workspace, rename one, or give it a colour.

## What came up

- **A tags place per workspace**, like TickTick's Tags section in the sidebar: every tag listed, each with a colour, and a menu per tag to rename, recolour, merge or delete it across every task.
- **Nested tags, as Obsidian has them**: `#area/garden` belongs to `#area`, and filtering by `#area` includes its children.
- **Wikilinks**: Obsidian treats a tag and a link as close relatives. octodo already reads `[[HM-3]]` in a body as a mention; tags could be written and read the same way, so a body's `#tag` counts as a tag and a tag can have its own page.

## Questions to settle

- Storage: tags stay in task frontmatter (the source of truth), but a tag's own settings (colour, description, order) need a home. A section of entries (`.octodo/tags/<slug>/tag.md`), a key in `config.json`, or nothing until a tag is configured?
- Is a tag in a body (`#garden`) the same tag as one in `tags:`? Which one wins, and what does a rename rewrite?
- Nesting: a `/` in the tag name, as Obsidian does? What filtering by a parent includes.
- Rename and merge are writes across many task files: one operation that holds the owner lock for all of them.
- Built in, or a plugin like counters and recurring tasks?
- Relation to [[OCT-94]] (list settings: icon and colour): one colour palette and picker for lists and tags.
