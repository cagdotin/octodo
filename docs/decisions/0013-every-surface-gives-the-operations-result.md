# 0013. Every surface gives an operation's own result

- Status: accepted
- Date: 2026-10-28

## Context

Before the operation catalog ([0005](0005-one-operation-catalog.md)), the CLI and MCP listed and
read tasks in different ways. `octo list` left out tasks in closed statuses unless `--all` was
given, sorted by status, and printed whole tasks with `--json`. MCP `list_tasks` returned every
task in the snapshot's order as summaries. `octo show --json` printed a task with subtasks, while
MCP `get_task` also resolved each linked task to its id, title and status. One catalog entry has
one input and one success, so the two could not both stay.

## Decision

- `list_tasks` leaves out tasks in a closed status category (completed, canceled, archived) unless
  `all` is true or `status` names one, and sorts by status in workflow order, keeping the order
  within a status. This is what `octo list` did. MCP agents now get the same default: what is left
  to do, grouped as on the board.
- The CLI's `--json` prints the operation's success, the same value MCP returns: `list_tasks` gives
  task summaries, and `get_task` and `update_task` give the task detail with links as
  `{ id, title, status }` and its attachments. The text output stays a renderer per operation.
- `get_task`'s detail lists direct subtasks only, so `octo show` lists those, where it used to
  show the whole subtree with each subtask's marks. `octo list` still shows the tree.

## Consequences

- An agent on MCP and a script on the CLI see the same data for the same call. The contract test
  table asserts it.
- A script that read full tasks from `octo list --json` reads summaries now. For the full task
  it runs `octo show <id> --json`.
- An agent that wants finished work asks for it with `status` or `all: true`.
- CLI flags come from the operation's input, so some spellings changed: `--tag` is `--tags`
  (repeat it or separate with commas), `--top-level` is `--no-parent`, and clearing a field is
  `--no-<field>` (`--no-due`, `--no-list`) instead of an empty value, so `--due ''` and
  `--title ''` are refused as invalid input. `octo list` gains `--parent` and `--query`, and
  `lists create`, `lists move` and `delete` gain `--json`.
