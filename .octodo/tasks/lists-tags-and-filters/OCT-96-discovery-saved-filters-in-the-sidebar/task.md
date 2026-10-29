---
id: OCT-96
title: "Discovery: saved filters in the sidebar"
status: backlog
priority: medium
tags:
  - discovery
  - filters
created: 2026-10-29T14:48:40.859Z
order: a2
---

## Not decided

Do not build this yet. Decide what a saved filter is, where it is stored, and whether it is a plugin.

## Today

The sidebar has fixed smart views (All tasks, Today, Next 7 days, Ready, No list) and the lists. The app's Filter menu narrows a view by priority, tag and list, but the choice is not saved or named, and `list_tasks` takes the same kinds of filters one call at a time.

## What came up

TickTick's Filters: a person builds a filter (say "In Progress": started tasks tagged work, due this week), names it, and it sits in its own sidebar section like a list. Opening it shows the tasks that match now.

## Questions to settle

- What a filter can say: statuses or categories, priority, tags (nested ones too, see [[OCT-95]]), lists, due ranges relative to today, ready or blocked, kind (recurring), text. AND only, or AND and OR?
- Storage: a section of entries (`.octodo/filters/<id>-<slug>/filter.md`, as decision 0027 lets a plugin add), so a filter is a file like everything else and agents can read and write it; or per-browser preferences, private to one person.
- One rule language shared by the app, `list_tasks` and MCP, so an agent can run a saved filter by its id.
- How a filter shows: list or board, grouping and sorting, the same display options [[OCT-94]] asks about for lists.
- Built in, or a plugin? Tags ([[OCT-95]]) and filters could both be plugins that add a sidebar section.
