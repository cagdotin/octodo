---
name: octodo
description: Read and manage this project's tasks, stored as markdown files under .octodo/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# octodo

This project's tasks live in `.octodo/`, one folder per task with a `task.md` inside. The files
are the source of truth; the octodo app, CLI and MCP server read and write them.

## Layout

- `.octodo/config.json`: workspace name, the id key (e.g. `CT`), statuses and their categories.
- A folder with `task.md` is a task (`CT-12-redo-the-bedroom/task.md`). Its frontmatter holds
  `id`, `title`, `status`, `priority` (none, low, medium, high, urgent), `tags`, `due`
  (YYYY-MM-DD), `created` and `order`; the body is markdown. Other keys are kept as-is.
- `blocked_by: [CT-3, CT-7]` lists the task ids a task waits for. It is blocked while any of them
  is open or missing; ready tasks are open and not blocked. `[[CT-3]]` in a body mentions CT-3.
- A task folder inside another task folder is a subtask. Any other file in a task folder, such as
  `images/plan.png`, is an attachment of that task.
- A folder with `list.md` is a list, nested up to three levels. List ids are the folder names
  joined by `/` (`garden/seeds`). Tasks directly in `.octodo/` are in no list.
- Folder names are only for people. Each task has a stable `id` (`CT-42`): refer to tasks by id,
  never by path.

## How to act

Change tasks through the `octodo` MCP tools or the CLI, not by editing or moving files: they keep
ids, order and folders consistent. With MCP, call `get_workspace` first. Each operation is an MCP
tool and, where it has one, an `octo` command with the same inputs as flags (`--no-<flag>`
clears a value; `octo <command> --help` lists them):

- `list_workspaces`, `octo workspace list`: List the workspaces registered on this machine.
- `get_workspace`, no command: Describe a workspace: its statuses (in order), lists, task counts and any files it could not read.
- `list_tasks`, `octo list`: List tasks in board order (by status, then their order), optionally filtered.
- `get_task`, `octo show <id>`: Read one task, including its markdown body, any extra frontmatter, its parent, its direct subtasks, the tasks it is blocked by and blocks, the tasks it mentions and is mentioned in, and its attachments (read one with read_attachment).
- `read_attachment`, `octo attachment <id> <path>`: Read one of a task's attachments by its path in the task folder, as get_task lists it.
- `create_task`, `octo create <title>`: Create a task.
- `update_task`, `octo update <id>`: Change a task's title, priority, tags, due date (YYYY-MM-DD, null clears it), markdown body or blocked_by (the task ids it waits for, replacing the current ones; [] clears them).
- `move_task`, `octo move <id> [<status>]`: Move a task to another status, list or parent task (a list or a parent, not both; parent null lifts a subtask into its list).
- `delete_task`, `octo delete <id>`: Delete a task's file permanently.
- `create_list`, `octo lists create <name>`: Create a list, last among its siblings.
- `move_list`, `octo lists move <id>`: Reorder a list among its siblings (before/after another list id) and/or move it under another parent (null for the top level).
- `list_diagnostics`, no command: List the problems with files in the workspace: each has a path, a kind, the frontmatter field at fault, a message saying what to do, and a fix when octodo can repair it.
- `fix_diagnostic`, no command: Apply the fix of one diagnostic, given its path, kind and fix action from list_diagnostics.

```sh
octo list                                                # Open tasks, subtasks under their parent
octo list --ready                                        # Open tasks that are not blocked
octo show HM-42                                          # One task
octo attachment HM-42 images/plan.png --output plan.png  # Save an attachment
octo create "Book the movers" -p high -t quotes          # A high-priority task
octo create "Buy primer" --parent HM-12                  # A subtask of HM-12
octo update HM-4 --body "Notes in markdown"              # A new body
octo update HM-4 --blocked-by HM-2,HM-3                  # HM-4 waits for both
octo update HM-4 --blocked-by ''                         # HM-4 waits for nothing
octo move HM-42 in-progress                              # Change its status
octo move HM-43 --parent HM-42                           # Make it a subtask; --no-parent lifts it out
```

If a command warns about a file, run `octo doctor`: it lists each problem and what to do about
it, and `octo doctor --fix` applies the fixes that cannot lose anything (with MCP, `list_diagnostics`
and `fix_diagnostic`). A fix that guesses, such as making a loose file a task, runs one at a time
with `octo doctor <path> --apply <fix>`, only when the user asks. Leave the rest to the user rather
than repairing files by hand.
Prefer moving finished or abandoned work to `done` or `archived` over deleting it.
