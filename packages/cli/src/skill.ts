/** The agent skill `octo skills export` writes, so agents in a project know how to use its tasks. */
export const SKILL = `---
name: octodo
description: Read and manage this project's tasks, stored as markdown files under .octodo/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# octodo

This project's tasks live in \`.octodo/\`, one markdown file per task with YAML frontmatter. The
files are the source of truth; the octodo app, CLI and MCP server all read and write them.

## Layout

- \`.octodo/config.json\`: workspace name, the id key (e.g. \`CT\`), statuses and their categories.
- \`.octodo/s<NN>-<status>/\`: tasks in that status, e.g. \`s01-todo\`, \`s02-in-progress\`. The
  number is only the workflow order; the status id is \`todo\`.
- \`.octodo/l<NN>-<name>/\` folders are lists, nested up to three levels; each holds its own status
  folders. List ids are the names without numbers, joined by \`/\` (\`garden/seeds\`).
- Changing a task's status moves its file to another status folder.
- Each task has a stable \`id\` (\`CT-42\`). Refer to tasks by id, never by file path.

Frontmatter the app manages: \`id\`, \`title\`, \`priority\` (none, low, medium, high, urgent),
\`tags\`, \`due\` (YYYY-MM-DD), \`created\`, \`updated\`, \`order\`. Any other keys are kept as-is.

## How to act

Prefer the \`octodo\` MCP tools when they are available (\`get_workspace\` first, then
\`list_tasks\`, \`get_task\`, \`create_task\`, \`update_task\`, \`move_task\`). Otherwise use the CLI:

\`\`\`sh
octo list                          # open tasks in board order (--status, --list, --tag, --json)
octo show CT-42                    # one task with its body
octo create "Title" --priority high --tag infra --status todo
octo update CT-42 --body "Notes in markdown"
octo move CT-42 in-progress        # change status (moves the file)
octo move CT-42 done
\`\`\`

Editing a file by hand also works; the app notices the change. Keep the frontmatter valid YAML,
and do not change \`id\`. Prefer moving finished or abandoned work to \`done\` or \`archived\`
over deleting it.
`;
