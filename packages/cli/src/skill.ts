import { CLI_ANNOTATION, type Operation } from "@octodo/contract/catalog";
import { makeRegistry } from "@octodo/engine";
import { plugins } from "@octodo/plugins";
import { SchemaAST } from "effect";

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0]!;

/** `octo move <id> [<status>]`: the words and the positional arguments of a command. */
const usage = (operation: Operation) => {
  if (operation.cli === undefined) return "no command";
  const positionals = Object.entries(operation.input.fields).flatMap(([key, field]) => {
    const annotation = SchemaAST.resolve(field.ast)?.[CLI_ANNOTATION] as
      | { readonly positional?: boolean }
      | undefined;
    if (annotation?.positional !== true) return [];
    return [SchemaAST.isOptional(field.ast) ? `[<${key}>]` : `<${key}>`];
  });
  return `\`${["octo", ...operation.cli.command, ...positionals].join(" ")}\``;
};

/** Every operation octodo has, plugins' included: the skill does not depend on a workspace. */
const operations = Object.entries(makeRegistry(plugins).operations);

const list = operations
  .map(
    ([name, operation]) =>
      `- \`${name}\`, ${usage(operation)}: ${firstSentence(operation.description)}`,
  )
  .join("\n");

const examples = operations.flatMap(([, operation]) => operation.cli?.examples ?? []);
const width = Math.max(...examples.map((example) => example.command.length));
const exampleBlock = examples
  .map((example) => `${example.command.padEnd(width)}  # ${example.description}`)
  .join("\n");

/** The agent skill `octo skills export` writes, so agents in a project know how to use its tasks. */
export const SKILL = `---
name: octodo
description: Read and manage this project's tasks, stored as markdown files under .octodo/. Use when asked about tasks, todos, the backlog, what to work on next, or to create, update, move or close a task.
---

# octodo

This project's tasks live in \`.octodo/tasks/\`, one folder per task with a \`task.md\` inside. The files
are the source of truth; the octodo app, CLI and MCP server read and write them.

## Layout

- \`.octodo/config.json\`: workspace name, the id key (e.g. \`CT\`), statuses and their categories.
- A folder with \`task.md\` is a task (\`CT-12-redo-the-bedroom/task.md\`). Its frontmatter holds
  \`id\`, \`title\`, \`status\`, \`priority\` (none, low, medium, high, urgent), \`tags\`, \`due\`
  (YYYY-MM-DD), \`created\` and \`order\`; the body is markdown. Other keys are kept as-is.
- \`blocked_by: [CT-3, CT-7]\` lists the task ids a task waits for. It is blocked while any of them
  is open or missing; ready tasks are open and not blocked. \`[[CT-3]]\` in a body mentions CT-3.
- A task folder inside another task folder is a subtask. Any other file in a task folder, such as
  \`images/plan.png\`, is an attachment of that task.
- A folder with \`list.md\` is a list, nested up to three levels. List ids are the folder names
  joined by \`/\` (\`garden/seeds\`). Tasks directly in \`.octodo/tasks/\` are in no list.
- Folder names are only for people. Each task has a stable \`id\` (\`CT-42\`): refer to tasks by id,
  never by path.

## How to act

Change tasks through the \`octodo\` MCP tools or the CLI, not by editing or moving files: they keep
ids, order and folders consistent. With MCP, call \`get_workspace\` first. Each operation is an MCP
tool and, where it has one, an \`octo\` command with the same inputs as flags (\`--no-<flag>\`
clears a value; \`octo <command> --help\` lists them):

${list}

\`\`\`sh
${exampleBlock}
\`\`\`

If a command warns about a file, run \`octo doctor\`: it lists each problem and what to do about
it, and \`octo doctor --fix\` applies the fixes that cannot lose anything (with MCP, \`list_diagnostics\`
and \`fix_diagnostic\`). A fix that guesses, such as making a loose file a task, runs one at a time
with \`octo doctor <path> --apply <fix>\`, only when the user asks. Leave the rest to the user rather
than repairing files by hand.
Prefer moving finished or abandoned work to \`done\` or \`archived\` over deleting it.
`;
