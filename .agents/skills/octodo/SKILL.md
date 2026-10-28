---
name: octodo
description: Read and manage this project's tasks, stored as markdown files under .octodo/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# octodo

This project's tasks live in `.octodo/tasks/`, one folder per task with a `task.md` inside. The files
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
  joined by `/` (`garden/seeds`). Tasks directly in `.octodo/tasks/` are in no list.
- Folder names are only for people. Each task has a stable `id` (`CT-42`): refer to tasks by id,
  never by path.

## How to act

Change tasks through the `octodo` MCP tools or the CLI, not by editing or moving files: they keep
ids, order and folders consistent. With MCP, call `get_workspace` first. Each operation is an MCP
tool and, where it has one, an `octo` command with the same inputs as flags (`--no-<flag>`
clears a value; `octo <command> --help` lists them):

- `list_workspaces`, `octo workspace list`: List the workspaces registered on this machine.
- `add_workspace`, no command: Create a workspace in a folder and register it on this machine: octodo writes .octodo/config.json there with the statuses and plugins of a preset, project unless preset names another.
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
- `list_plugins`, `octo plugins list`: List the plugins octodo has, each a kind of task a workspace can enable: get_workspace says which ones it enables.
- `enable_plugin`, `octo plugins enable <plugin>`: Enable a plugin in a workspace, adding it to config.json's plugins.
- `disable_plugin`, `octo plugins disable <plugin>`: Disable a plugin in a workspace, removing it from config.json's plugins.
- `create_recurring`, `octo recurring create <title>`: Create a recurring task, which comes back after it is done.
- `set_repeat`, `octo recurring repeat <id> <repeat>`: Change a recurring task's rule.
- `log_occurrence`, `octo recurring log <id>`: Record that a recurring task was done, now or at an earlier time, without changing its status.
- `remove_occurrence`, `octo recurring unlog <id> <at>`: Remove one time a recurring task was done, by its time as list_occurrences gives it.
- `list_occurrences`, `octo recurring history <id>`: List every time a recurring task was done, newest first.
- `create_counter`, `octo counter create <title>`: Create a days-since counter, which counts the days since something last happened, from now.
- `reset_counter`, `octo counter reset <id>`: Record that the counted thing happened, now or at an earlier time: the count starts again from the latest reset.
- `remove_reset`, `octo counter unreset <id> <at>`: Take back one reset of a counter, by its time as list_resets gives it.
- `list_resets`, `octo counter history <id>`: List every time a counter was reset, newest first.
- `create_anniversary`, `octo anniversary create <title>`: Create an anniversary: a task for a date that comes back every year, such as a birthday.
- `set_anniversary_date`, `octo anniversary date <id> <date>`: Change the day an anniversary first happened.

```sh
octo list                                                         # Open tasks, subtasks under their parent
octo list --ready                                                 # Open tasks that are not blocked
octo list --due-by 2026-11-01                                     # Open tasks due by November 1, overdue ones and chores included
octo show HM-42                                                   # One task
octo attachment HM-42 images/plan.png --output plan.png           # Save an attachment
octo create "Book the movers" -p high -t quotes                   # A high-priority task
octo create "Buy primer" --parent HM-12                           # A subtask of HM-12
octo update HM-4 --body "Notes in markdown"                       # A new body
octo update HM-4 --blocked-by HM-2,HM-3                           # HM-4 waits for both
octo update HM-4 --blocked-by ''                                  # HM-4 waits for nothing
octo move HM-42 in-progress                                       # Change its status
octo move HM-43 --parent HM-42                                    # Make it a subtask; --no-parent lifts it out
octo plugins enable recurring                                     # Let tasks repeat
octo recurring create "Water the plants" --repeat "every 3 days"  # A chore that comes back three days after each time
octo recurring log HM-4 --at 2026-10-25                           # It was done on the 25th
octo counter create "Days since I last smoked"                    # A counter that starts today
octo counter reset HM-4 --at 2026-10-16                           # It last happened on the 16th
octo anniversary create "Mum's birthday" --date 1961-06-14        # A birthday that comes back every June 14
```

If a command warns about a file, run `octo doctor`: it lists each problem and what to do about
it, and `octo doctor --fix` applies the fixes that cannot lose anything (with MCP, `list_diagnostics`
and `fix_diagnostic`). A fix that guesses, such as making a loose file a task, runs one at a time
with `octo doctor <path> --apply <fix>`, only when the user asks. Leave the rest to the user rather
than repairing files by hand.
Prefer moving finished or abandoned work to `done` or `archived` over deleting it.
