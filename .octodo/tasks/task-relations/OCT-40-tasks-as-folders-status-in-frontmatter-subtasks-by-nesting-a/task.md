---
id: OCT-40
title: "Tasks as folders: status in frontmatter, subtasks by nesting, attachments"
tags:
  - core
  - mcp
  - cli
  - web
created: 2026-10-27T12:02:27.409Z
order: a0
status: done
---

The on-disk model, redesigned. The path is a containment tree and nothing else. The frontmatter holds every attribute, status included.

```
.octodo/
  config.json                    workspace: name, key, statuses
  home/
    list.md                      this folder is a list
    OCT-12-redo-the-bedroom/
      task.md                    this folder is a task
      images/floor-plan.png      attachments belong to the task
      OCT-13-buy-primer/
        task.md                  a subtask, same shape all the way down
  OCT-2-qr-code-pairing/
    task.md                      a task in no list
```

## Grammar

1. A folder with `task.md` is a task. Its task subfolders are its subtasks. Every other file or folder in it belongs to it.
2. A folder with `list.md` is a list. It holds lists (at most 3 levels, as today) and tasks. `.octodo/` is the root list.
3. Anything else is a diagnostic: a list inside a task, a loose `.md` in a list, a folder with neither marker outside a task, a folder with both. Dot folders are ignored.

Folder names carry no meaning for the scanner. A task folder is named `<id>-<slug>` for people; a list folder is its slug, and the list id stays the slugs joined by `/`.

## Frontmatter

- task.md: `id` and `title` required, `status` (missing reads as the default status), `order` (fractional, among siblings in the same container whatever their status), `priority`, `due`, `tags` written only when set, `created`. No `updated` (it turns every concurrent edit into a sync conflict): the schema's `updated` comes from the file's mtime. `parent` and `list` are never stored.
- list.md: `name`, `order`. The body is the list's description.
- An unknown status value is a diagnostic and gets added as an unstarted status, as unknown status folders were.

## Operations

- Create: write `task.md` into a dot-named temp folder inside the container, then rename it into place.
- Status, priority, order, body: one atomic write of `task.md`. A status-only move keeps the task's order.
- Move to a list or under a task (`list` or `parent`, never both): one folder rename. Refuse a move into the task's own subtree.
- Title change: rename the folder to match first, then write `task.md`, so a failed rename changes nothing. A stale folder name is harmless and the next rename fixes it.
- Delete: remove the folder and its subtasks.
- Reorder statuses: `config.json` only.
- Never create a container with `mkdir -p`. Writes go only into folders that exist.

## Surfaces

- Core: `Task` gains `parent` (derived). Status and list from the new grammar.
- MCP and CLI: `parent` on create and move, `octo migrate`.
- Server: serve and upload a task's attachments, with path traversal refused.
- Web: list and board show top-level tasks with a subtask progress chip. Smart views include subtasks. Task detail lists subtasks with a checkbox (done or open) and a way to add one. Pasted or dropped images go to `images/` and render in the body; only images in the task folder render.

## Migration

`octo migrate` turns `s<NN>-x/ID-slug.md` into `ID-slug/task.md` with `status: x`, and `l<NN>-slug/` into `slug/list.md` with the number as its order. It drops `updated`. Running it twice changes nothing. The scanner reports an old-layout workspace with a pointer to `octo migrate`, and new tasks are refused until it runs.
