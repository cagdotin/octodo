import type { Task, TaskRef } from "@octodo/contract";
import type { OperationName } from "@octodo/contract/catalog";
import type { OperationSuccess } from "@octodo/engine";

/** What a task line shows: a task from the snapshot, a summary or a detail. */
type Shown = Pick<
  Task,
  "id" | "title" | "status" | "priority" | "tags" | "due" | "list" | "blocked"
>;

const priorityMark: Record<Task["priority"], string> = {
  none: "",
  low: "!low",
  medium: "!med",
  high: "!high",
  urgent: "!urgent",
};

const heading = (task: Pick<Task, "id" | "status" | "title">) => [
  task.id.padEnd(8),
  `[${task.status}]`.padEnd(14),
  task.title,
];

export const line = (task: Shown) =>
  [
    ...heading(task),
    priorityMark[task.priority],
    ...task.tags.map((tag) => `#${tag}`),
    task.due === null ? "" : `due ${task.due}`,
    task.list === null ? "" : `(${task.list})`,
    task.blocked ? "[blocked]" : "",
  ]
    .filter((part) => part !== "")
    .join("  ");

/**
 * `tasks` in their order with each subtask right after its parent, one level deeper. A subtask
 * whose parent is not in `tasks` stays at depth 0.
 */
const tree = <T extends { readonly id: string; readonly parent: string | null }>(
  tasks: ReadonlyArray<T>,
) => {
  const shown = new Set(tasks.map((task) => task.id));
  const roots = tasks.filter((task) => task.parent === null || !shown.has(task.parent));
  const children = Map.groupBy(
    tasks.filter((task) => !roots.includes(task)),
    (task) => task.parent,
  );
  const rows: Array<{ readonly task: T; readonly depth: number }> = [];
  const walk = (task: T, depth: number) => {
    rows.push({ task, depth });
    for (const child of children.get(task.id) ?? []) walk(child, depth + 1);
  };
  for (const task of roots) walk(task, 0);
  return rows;
};

const named = (refs: ReadonlyArray<TaskRef>) =>
  refs
    .map((ref) => (ref.title === null ? `${ref.id} (no such task)` : `${ref.id} ${ref.title}`))
    .join(", ");

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${Math.ceil(size / 1024 / 1024)} MB`;

/** How `octo` prints an operation's success when `--json` is not given, line by line. */
export const renderers: {
  readonly [K in OperationName]?: (result: OperationSuccess<K>) => ReadonlyArray<string>;
} = {
  list_workspaces: (all) =>
    all.map((info) => `${info.id.padEnd(20)} ${info.key.padEnd(6)} ${info.root}`),
  list_tasks: (tasks) =>
    tasks.length === 0
      ? ["No tasks"]
      : tree(tasks).map(({ task, depth }) => {
          const under = depth === 0 && task.parent !== null ? `  (under ${task.parent})` : "";
          return `${"  ".repeat(depth)}${line(task)}${under}`;
        }),
  get_task: (task) => [
    line(task),
    ...(task.parent === null ? [] : [`parent: ${task.parent}`]),
    ...(
      [
        ["blocked by", task.blockedBy],
        ["blocks", task.blocks],
        ["mentions", task.mentions],
        ["mentioned in", task.mentionedIn],
      ] as const
    ).flatMap(([label, refs]) => (refs.length === 0 ? [] : [`${label}: ${named(refs)}`])),
    `path: ${task.path}`,
    ...(task.subtasks.length === 0
      ? []
      : ["subtasks:", ...task.subtasks.map((sub) => `  ${heading(sub).join("  ")}`)]),
    ...(task.attachments.length === 0
      ? []
      : [
          "attachments:",
          ...task.attachments.map(
            (file) => `  ${file.path}  ${file.mediaType.split(";")[0]}  ${bytes(file.size)}`,
          ),
        ]),
    ...(task.body.length === 0 ? [] : [`\n${task.body.trimEnd()}`]),
  ],
  create_task: (task) => [line(task)],
  update_task: (task) => [line(task)],
  move_task: (task) => [line(task)],
  delete_task: ({ deleted }) => [`Deleted ${deleted}`],
  create_list: (list) => [`Created list ${list.id} in ${list.folder}`],
  move_list: (list) => [`Moved list ${list.id} to ${list.folder}`],
};
