import type { Entry, EntryDay, Task, TaskKind, TaskRef, TaskSummary } from "@octodo/contract";
import type { OperationName } from "@octodo/contract/catalog";
import type { OperationSuccess } from "@octodo/engine";

/** What a task line shows: a task from the snapshot, a summary or a detail. */
type Shown = Pick<
  Task,
  "id" | "title" | "status" | "priority" | "tags" | "due" | "list" | "blocked" | "kind"
>;

/** The few words a task's kind adds to its line, from its plugin's `label`; empty for none. */
export type KindLabel = (kind: TaskKind | undefined) => string;

const noLabel: KindLabel = () => "";

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

export const line = (task: Shown, label = noLabel) =>
  [
    ...heading(task),
    priorityMark[task.priority],
    ...task.tags.map((tag) => `#${tag}`),
    task.due === null ? "" : `due ${task.due}`,
    label(task.kind),
    task.list === null ? "" : `(${task.list})`,
    task.blocked ? "[blocked]" : "",
  ]
    .filter((part) => part !== "")
    .join("  ");

/** An entry of a plugin's section: its id, its section, its title and its plugin's label. */
export const entryLine = (
  entry: Pick<Entry, "id" | "section" | "title" | "fields">,
  label = noLabel,
) =>
  [
    ...heading({ ...entry, status: entry.section }),
    label({ id: entry.section, fields: entry.fields }),
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

const isEntryDay = (row: TaskSummary | EntryDay): row is EntryDay => "section" in row;

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

const enabledPlugins = (plugins: ReadonlyArray<string>) => [
  plugins.length === 0 ? "No plugins enabled" : `Enabled: ${plugins.join(", ")}`,
];

/** How `octo` prints an operation's success when `--json` is not given, line by line. */
export const renderers: {
  readonly [K in OperationName]?: (
    result: OperationSuccess<K>,
    label: KindLabel,
  ) => ReadonlyArray<string>;
} = {
  list_workspaces: (all) =>
    all.map((info) => `${info.id.padEnd(20)} ${info.key.padEnd(6)} ${info.root}`),
  list_tasks: (rows, label) => {
    const tasks = rows.filter((row): row is TaskSummary => !isEntryDay(row));
    const days = rows.filter(isEntryDay);
    return rows.length === 0
      ? ["No tasks"]
      : [
          ...tree(tasks).map(({ task, depth }) => {
            const under = depth === 0 && task.parent !== null ? `  (under ${task.parent})` : "";
            return `${"  ".repeat(depth)}${line(task, label)}${under}`;
          }),
          ...days.map((entry) =>
            heading({ ...entry, status: entry.section })
              .concat(`on ${entry.day}`)
              .join("  "),
          ),
        ];
  },
  get_task: (task, label) => [
    line(task, label),
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
  create_task: (task, label) => [line(task, label)],
  update_task: (task, label) => [line(task, label)],
  move_task: (task, label) => [line(task, label)],
  delete_task: ({ deleted }) => [`Deleted ${deleted}`],
  create_list: (list) => [`Created list ${list.id} in ${list.folder}`],
  move_list: (list) => [`Moved list ${list.id} to ${list.folder}`],
  rename_list: (list) => [`Renamed list ${list.id} to ${list.name}`],
  delete_list: ({ deleted, unlisted, deletedTasks }) => [
    `Deleted list ${deleted}`,
    ...(unlisted.length > 0 ? [`Moved out of any list: ${unlisted.join(", ")}`] : []),
    ...(deletedTasks.length > 0 ? [`Deleted tasks: ${deletedTasks.join(", ")}`] : []),
  ],
  list_plugins: (plugins) =>
    plugins.map((plugin) => `${plugin.id.padEnd(14)} ${plugin.name}: ${plugin.description}`),
  enable_plugin: enabledPlugins,
  disable_plugin: enabledPlugins,
};
