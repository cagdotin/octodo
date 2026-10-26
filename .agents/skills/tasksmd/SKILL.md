---
name: tasksmd
description: Read and manage this project's tasks, stored as markdown files under .tasks/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# tasksmd

This project's tasks live in `.tasks/`, one markdown file per task with YAML frontmatter. The
files are the source of truth; the tasksmd app, CLI and MCP server all read and write them.

## Layout

- `.tasks/config.json`: workspace name, the id key (e.g. `CT`), status order and categories.
- `.tasks/s-<status>/`: tasks in that status, e.g. `s-todo`, `s-in-progress`, `s-done`.
- `.tasks/c-<name>/` (category) and `.tasks/p-<name>/` (project) are lists; each holds its own
  `s-<status>/` folders.
- Changing a task's status moves its file to another status folder.
- Each task has a stable `id` (`CT-42`). Refer to tasks by id, never by file path.

Frontmatter the app manages: `id`, `title`, `priority` (none, low, medium, high, urgent),
`tags`, `due` (YYYY-MM-DD), `created`, `updated`, `order`. Any other keys are kept as-is.

## How to act

Prefer the `tasksmd` MCP tools when they are available (`get_workspace` first, then
`list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`). Otherwise use the CLI:

```sh
tasksmd list                       # open tasks in board order (--status, --list, --tag, --json)
tasksmd show CT-42                 # one task with its body
tasksmd create "Title" --priority high --tag infra --status todo
tasksmd update CT-42 --body "Notes in markdown"
tasksmd move CT-42 in-progress     # change status (moves the file)
tasksmd move CT-42 done
```

Editing a file by hand also works; the app notices the change. Keep the frontmatter valid YAML,
and do not change `id`. Prefer moving finished or abandoned work to `done` or `archived`
over deleting it.
