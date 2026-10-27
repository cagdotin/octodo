/** The agent skill `octo skills export` writes, so agents in a project know how to use its tasks. */
export const SKILL = `---
name: octodo
description: Read and manage this project's tasks, stored as markdown files under .octodo/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# octodo

This project's tasks live in \`.octodo/\`, one folder per task with a \`task.md\` inside. The files
are the source of truth; the octodo app, CLI and MCP server read and write them.

## Layout

- \`.octodo/config.json\`: workspace name, the id key (e.g. \`CT\`), statuses and their categories.
- A folder with \`task.md\` is a task (\`CT-12-redo-the-bedroom/task.md\`). Its frontmatter holds
  \`id\`, \`title\`, \`status\`, \`priority\` (none, low, medium, high, urgent), \`tags\`, \`due\`
  (YYYY-MM-DD), \`created\` and \`order\`; the body is markdown. Other keys are kept as-is.
- A task folder inside another task folder is a subtask. Any other file in a task folder, such as
  \`images/plan.png\`, is an attachment of that task.
- A folder with \`list.md\` is a list, nested up to three levels. List ids are the folder names
  joined by \`/\` (\`garden/seeds\`). Tasks directly in \`.octodo/\` are in no list.
- Folder names are only for people. Each task has a stable \`id\` (\`CT-42\`): refer to tasks by id,
  never by path.

## How to act

Change tasks through the \`octodo\` MCP tools or the CLI, not by editing or moving files: they keep
ids, order and folders consistent. With MCP, call \`get_workspace\` first, then \`list_tasks\`,
\`get_task\`, \`create_task\`, \`update_task\`, \`move_task\`. Otherwise:

\`\`\`sh
octo list                          # open tasks in board order, subtasks under their parent
octo show CT-42                    # one task with its subtasks and body
octo create "Title" --priority high --tag infra --status todo
octo create "Buy primer" --parent CT-42   # a subtask
octo update CT-42 --body "Notes in markdown"
octo move CT-42 in-progress        # change status
octo move CT-43 --parent CT-42     # make it a subtask; --no-parent lifts it out
octo move CT-42 done
\`\`\`

If a command warns about a file, run \`octo doctor\`: it lists each problem and what to do about
it, and \`octo doctor --fix\` applies the fixes octodo can make (with MCP, \`list_diagnostics\` and
\`fix_diagnostic\`). Leave the rest to the user rather than repairing files by hand.
Prefer moving finished or abandoned work to \`done\` or \`archived\` over deleting it.
`;
