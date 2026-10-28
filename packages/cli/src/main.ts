import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  FixAction,
  InvalidRequest,
  Priority,
  Workspaces,
  defaultHome,
  isClosedCategory,
  taskSubtree,
  type Diagnostic,
  type Task,
} from "@octodo/core";
import { stdioLayer } from "@octodo/mcp";
import { DEFAULT_PORT, startServer } from "@octodo/server";
import { Console, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { SKILL } from "./skill.ts";

const home = defaultHome(process.env, homedir());

const octo = Command.make("octo").pipe(
  Command.withSharedFlags({
    workspace: Flag.String("workspace").pipe(
      Flag.withAlias("w"),
      Flag.withDescription(
        "Workspace id or folder; defaults to the one containing the current directory",
      ),
      Flag.optional,
    ),
  }),
  Command.withDescription("Tasks as markdown files, managed from the terminal"),
);

const json = Flag.Boolean("json").pipe(Flag.withDescription("Print JSON"), Flag.withDefault(false));
const priority = Flag.Literals("priority", Priority.literals).pipe(
  Flag.withAlias("p"),
  Flag.optional,
);
const tags = Flag.String("tag").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Tag; repeat for several"),
  Flag.atLeast(0),
);
const due = Flag.String("due").pipe(
  Flag.withDescription("Due date, YYYY-MM-DD; empty clears it"),
  Flag.optional,
);
const body = Flag.String("body").pipe(Flag.withDescription("Markdown body"), Flag.optional);
const list = Flag.String("list").pipe(
  Flag.withAlias("l"),
  Flag.withDescription("List id, e.g. groceries or garden/seeds"),
  Flag.optional,
);
const parent = Flag.String("parent").pipe(
  Flag.withDescription("Parent task id, making this a subtask"),
  Flag.optional,
);
const taskId = Argument.String("id").pipe(Argument.withDescription("Task id, e.g. HM-42"));

/** The folder `--workspace` names, or the current directory. */
const target = Effect.map(octo, (root) => Option.getOrElse(root.workspace, () => process.cwd()));

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const isNote = (diagnostic: Diagnostic) => diagnostic.kind === "note";

/**
 * The workspace named by `--workspace`, or the one containing the current directory. Prints what
 * its files have wrong on stderr, notes aside, and points at `octo doctor` when some of it can be
 * fixed.
 */
const workspace = Effect.gen(function* () {
  const ws = yield* (yield* Workspaces).open(yield* target);
  const problems = (yield* ws.snapshot).diagnostics.filter((diagnostic) => !isNote(diagnostic));
  for (const diagnostic of problems)
    yield* Console.error(`warning: ${diagnostic.path}: ${diagnostic.message}`);
  if (problems.some((diagnostic) => diagnostic.fix?.inFixAll === true))
    yield* Console.error("Run `octo doctor --fix` to fix what octodo can.");
  else if (problems.some((diagnostic) => diagnostic.fix !== null))
    yield* Console.error("Run `octo doctor` to pick the fixes to apply.");
  return ws;
});

const optional = <A>(option: Option.Option<A>) => Option.getOrUndefined(option);

const priorityMark: Record<Task["priority"], string> = {
  none: "",
  low: "!low",
  medium: "!med",
  high: "!high",
  urgent: "!urgent",
};

const line = (task: Task) =>
  [
    task.id.padEnd(8),
    `[${task.status}]`.padEnd(14),
    task.title,
    priorityMark[task.priority],
    ...task.tags.map((tag) => `#${tag}`),
    task.due === null ? "" : `due ${task.due}`,
    task.list === null ? "" : `(${task.list})`,
    task.blocked ? "[blocked]" : "",
  ]
    .filter((part) => part !== "")
    .join("  ");

const print = (task: Task, asJson: boolean) =>
  asJson ? Console.log(JSON.stringify(task, null, 2)) : Console.log(line(task));

/**
 * `tasks` in their order with each subtask right after its parent, one level deeper. A subtask
 * whose parent is not in `tasks` stays at depth 0.
 */
const tree = (tasks: ReadonlyArray<Task>) => {
  const shown = new Set(tasks.map((task) => task.id));
  const roots = tasks.filter((task) => task.parent === null || !shown.has(task.parent));
  const children = Map.groupBy(
    tasks.filter((task) => !roots.includes(task)),
    (task) => task.parent,
  );
  const rows: Array<{ readonly task: Task; readonly depth: number }> = [];
  const walk = (task: Task, depth: number) => {
    rows.push({ task, depth });
    for (const child of children.get(task.id) ?? []) walk(child, depth + 1);
  };
  for (const task of roots) walk(task, 0);
  return rows;
};

const listCommand = Command.make(
  "list",
  {
    status: Flag.String("status").pipe(Flag.withAlias("s"), Flag.optional),
    list,
    tag: Flag.String("tag").pipe(Flag.withAlias("t"), Flag.optional),
    all: Flag.Boolean("all").pipe(
      Flag.withAlias("a"),
      Flag.withDescription("Include done and archived tasks"),
      Flag.withDefault(false),
    ),
    ready: Flag.Boolean("ready").pipe(
      Flag.withDescription("Only tasks that can start now: open and not blocked"),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (options) {
    const snapshot = yield* (yield* workspace).snapshot;
    const closed = new Set(
      snapshot.statuses
        .filter((status) => isClosedCategory(status.category))
        .map((status) => status.id),
    );
    const order = new Map(snapshot.statuses.map((status, index) => [status.id, index]));
    const tasks = snapshot.tasks
      .filter(
        (task) =>
          (Option.isSome(options.status)
            ? task.status === options.status.value
            : options.all || !closed.has(task.status)) &&
          (Option.isNone(options.list) || task.list === options.list.value) &&
          (Option.isNone(options.tag) || task.tags.includes(options.tag.value)) &&
          (!options.ready || task.ready),
      )
      .toSorted((a, b) => (order.get(a.status) ?? 0) - (order.get(b.status) ?? 0));
    if (options.json) return yield* Console.log(JSON.stringify(tasks, null, 2));
    if (tasks.length === 0) return yield* Console.log("No tasks");
    for (const { task, depth } of tree(tasks)) {
      const under = depth === 0 && task.parent !== null ? `  (under ${task.parent})` : "";
      yield* Console.log(`${"  ".repeat(depth)}${line(task)}${under}`);
    }
  }),
).pipe(Command.withDescription("List open tasks in board order"), Command.withAlias("ls"));

const showCommand = Command.make(
  "show",
  { id: taskId, json },
  Effect.fn(function* ({ id, json: asJson }) {
    const ws = yield* workspace;
    const task = yield* ws.getTask(id);
    const { tasks } = yield* ws.snapshot;
    const subtree = taskSubtree(tasks, id);
    const subtasks = tree(tasks.filter((other) => other.id !== id && subtree.has(other.id)));
    if (asJson) {
      const summaries = subtasks
        .filter(({ task: sub }) => sub.parent === id)
        .map(({ task: { id, title, status } }) => ({ id, title, status }));
      return yield* Console.log(JSON.stringify({ ...task, subtasks: summaries }, null, 2));
    }
    yield* Console.log(line(task));
    if (task.parent !== null) yield* Console.log(`parent: ${task.parent}`);
    const named = (ids: ReadonlyArray<string>) =>
      ids
        .map((linked) => {
          const other = tasks.find((candidate) => candidate.id === linked);
          return other === undefined ? `${linked} (no such task)` : `${linked} ${other.title}`;
        })
        .join(", ");
    for (const [label, ids] of [
      ["blocked by", task.blockedBy],
      ["blocks", task.blocks],
      ["mentions", task.mentions],
      ["mentioned in", task.mentionedIn],
    ] as const) {
      if (ids.length > 0) yield* Console.log(`${label}: ${named(ids)}`);
    }
    yield* Console.log(`path: ${task.path}`);
    if (subtasks.length > 0) yield* Console.log("subtasks:");
    for (const { task: sub, depth } of subtasks)
      yield* Console.log(`${"  ".repeat(depth + 1)}${line(sub)}`);
    if (task.body.length > 0) yield* Console.log(`\n${task.body.trimEnd()}`);
  }),
).pipe(Command.withDescription("Show one task with its subtasks and body"));

const createCommand = Command.make(
  "create",
  {
    title: Argument.String("title"),
    status: Flag.String("status").pipe(Flag.withAlias("s"), Flag.optional),
    list,
    parent,
    priority,
    tags,
    due,
    body,
    json,
  },
  Effect.fn(function* (options) {
    const ws = yield* workspace;
    const task = yield* ws.createTask({
      title: options.title,
      ...(Option.isSome(options.status) ? { status: options.status.value } : {}),
      ...(Option.isSome(options.list) ? { list: options.list.value } : {}),
      ...(Option.isSome(options.parent) ? { parent: options.parent.value } : {}),
      ...(Option.isSome(options.priority) ? { priority: options.priority.value } : {}),
      ...(options.tags.length > 0 ? { tags: options.tags } : {}),
      ...(Option.isSome(options.due) ? { due: options.due.value || null } : {}),
      ...(Option.isSome(options.body) ? { body: options.body.value } : {}),
    });
    yield* print(task, options.json);
  }),
).pipe(
  Command.withDescription("Create a task"),
  Command.withAlias("add"),
  Command.withExamples([
    {
      command: 'octo create "Book the movers" -p high -t quotes',
      description: "A high-priority task",
    },
    { command: 'octo create "Buy primer" --parent HM-12', description: "A subtask of HM-12" },
  ]),
);

const updateCommand = Command.make(
  "update",
  {
    id: taskId,
    title: Flag.String("title").pipe(Flag.optional),
    priority,
    tags,
    due,
    body,
    blockedBy: Flag.String("blocked-by").pipe(
      Flag.withDescription("Task ids it waits for, comma-separated; empty clears them"),
      Flag.optional,
    ),
    json,
  },
  Effect.fn(function* (options) {
    const ws = yield* workspace;
    const task = yield* ws.updateTask(options.id, {
      ...(Option.isSome(options.title) && options.title.value.length > 0
        ? { title: options.title.value }
        : {}),
      ...(Option.isSome(options.priority) ? { priority: options.priority.value } : {}),
      ...(options.tags.length > 0 ? { tags: options.tags } : {}),
      ...(Option.isSome(options.due) ? { due: options.due.value || null } : {}),
      ...(Option.isSome(options.body) ? { body: options.body.value } : {}),
      ...(Option.isSome(options.blockedBy)
        ? {
            blocked_by: options.blockedBy.value
              .split(",")
              .map((id) => id.trim())
              .filter((id) => id !== ""),
          }
        : {}),
    });
    yield* print(task, options.json);
  }),
).pipe(
  Command.withDescription("Change a task's title, priority, tags, due date, body or blockers"),
  Command.withExamples([
    { command: "octo update HM-4 --blocked-by HM-2,HM-3", description: "HM-4 waits for both" },
    { command: "octo update HM-4 --blocked-by ''", description: "HM-4 waits for nothing" },
  ]),
);

const moveCommand = Command.make(
  "move",
  {
    id: taskId,
    status: Argument.String("status").pipe(
      Argument.withDescription("Target status, e.g. in-progress"),
      Argument.optional,
    ),
    list,
    noList: Flag.Boolean("no-list").pipe(
      Flag.withDescription("Move out of any list"),
      Flag.withDefault(false),
    ),
    parent,
    noParent: Flag.Boolean("no-parent").pipe(
      Flag.withDescription("Lift a subtask out to its parent's list"),
      Flag.withDefault(false),
    ),
    before: Flag.String("before").pipe(Flag.optional),
    after: Flag.String("after").pipe(Flag.optional),
    json,
  },
  Effect.fn(function* (options) {
    const ws = yield* workspace;
    const task = yield* ws.moveTask(options.id, {
      ...(Option.isSome(options.status) ? { status: options.status.value } : {}),
      ...(options.noList
        ? { list: null }
        : Option.isSome(options.list)
          ? { list: options.list.value }
          : {}),
      ...(options.noParent
        ? { parent: null }
        : Option.isSome(options.parent)
          ? { parent: options.parent.value }
          : {}),
      ...(Option.isSome(options.before) ? { before: options.before.value } : {}),
      ...(Option.isSome(options.after) ? { after: options.after.value } : {}),
    });
    yield* print(task, options.json);
  }),
).pipe(Command.withDescription("Move a task to another status, list or parent task"));

const deleteCommand = Command.make(
  "delete",
  { id: taskId },
  Effect.fn(function* ({ id }) {
    yield* (yield* workspace).deleteTask(id);
    yield* Console.log(`Deleted ${id}`);
  }),
).pipe(Command.withDescription("Delete a task's folder with its subtasks and attachments"));

const describeDiagnostic = (diagnostic: Diagnostic) =>
  [
    `${diagnostic.path}  [${diagnostic.kind}${diagnostic.field === null ? "" : ` ${diagnostic.field}`}]`,
    `  ${diagnostic.message}`,
    ...(diagnostic.fix === null
      ? []
      : [
          `  fix: ${diagnostic.fix.label} (octo doctor ${JSON.stringify(diagnostic.path)} --apply ${diagnostic.fix.action})`,
        ]),
  ].join("\n");

const doctorCommand = Command.make(
  "doctor",
  {
    path: Argument.String("path").pipe(
      Argument.withDescription("The path of one problem, for --apply"),
      Argument.optional,
    ),
    apply: Flag.Literals("apply", FixAction.literals).pipe(
      Flag.withDescription("Apply this fix to the problem at <path>, if octodo still offers it"),
      Flag.optional,
    ),
    fix: Flag.Boolean("fix").pipe(
      Flag.withDescription("Apply every fix octodo offers, then list what is left"),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (options) {
    const ws = yield* (yield* Workspaces).open(yield* target);
    const applyOne = (action: FixAction) =>
      Effect.gen(function* () {
        if (Option.isNone(options.path))
          return yield* new InvalidRequest({ message: "--apply needs the problem's path" });
        const path = options.path.value;
        const offered = (yield* ws.snapshot).diagnostics.find(
          (diagnostic) => diagnostic.path === path && diagnostic.fix?.action === action,
        );
        if (offered === undefined)
          return yield* new InvalidRequest({ message: `No problem at ${path} offers ${action}` });
        return yield* ws.fixDiagnostic({ path, kind: offered.kind, action });
      });
    const result = Option.isSome(options.apply)
      ? yield* applyOne(options.apply.value)
      : options.fix
        ? yield* ws.fixAll
        : { fixed: [], failed: [], diagnostics: (yield* ws.snapshot).diagnostics };
    const problems = result.diagnostics.filter((diagnostic) => !isNote(diagnostic));
    if (problems.length > 0) process.exitCode = 1;
    if (options.json) return yield* Console.log(JSON.stringify(result, null, 2));
    for (const fixed of result.fixed)
      yield* Console.log(`fixed: ${fixed.path}: ${fixed.fix?.label ?? fixed.kind}`);
    for (const { diagnostic, error } of result.failed)
      yield* Console.error(`could not fix ${diagnostic.path}: ${error}`);
    if (result.diagnostics.length === 0) return yield* Console.log(`No problems in ${ws.root}`);
    if (result.fixed.length > 0 || result.failed.length > 0) yield* Console.log("");
    yield* Console.log(result.diagnostics.map(describeDiagnostic).join("\n\n"));
    const fixable = problems.filter((diagnostic) => diagnostic.fix?.inFixAll === true).length;
    const notes = result.diagnostics.length - problems.length;
    yield* Console.log(
      `\n${count(problems.length, "problem")}${notes > 0 ? ` and ${count(notes, "note")}` : ""}${fixable > 0 && !options.fix ? `; run \`octo doctor --fix\` to fix ${fixable}` : ""}`,
    );
  }),
).pipe(
  Command.withDescription(
    "List problems with the workspace's files, with what to do about each; --fix applies the safe fixes, <path> --apply <fix> one fix",
  ),
);

const initCommand = Command.make(
  "init",
  {
    dir: Argument.String("dir").pipe(Argument.withDefault(".")),
    name: Flag.String("name").pipe(Flag.optional),
    key: Flag.String("key").pipe(Flag.withDescription("Id prefix, e.g. CT"), Flag.optional),
  },
  Effect.fn(function* ({ dir, name, key }) {
    const info = yield* (yield* Workspaces).add(dir, { name: optional(name), key: optional(key) });
    yield* Console.log(
      `Workspace "${info.name}" (${info.key}) at ${info.root}, registered as ${info.id}`,
    );
  }),
).pipe(Command.withDescription("Create .octodo/ in a folder and register it"));

const workspaceCommand = Command.make("workspace").pipe(
  Command.withDescription("Manage registered workspaces"),
  Command.withSubcommands([
    Command.make(
      "list",
      { json },
      Effect.fn(function* (options) {
        const all = yield* (yield* Workspaces).list;
        if (options.json) return yield* Console.log(JSON.stringify(all, null, 2));
        for (const info of all)
          yield* Console.log(`${info.id.padEnd(20)} ${info.key.padEnd(6)} ${info.root}`);
      }),
    ).pipe(Command.withDescription("List registered workspaces")),
    Command.make(
      "remove",
      { id: Argument.String("id") },
      Effect.fn(function* ({ id }) {
        yield* (yield* Workspaces).remove(id);
        yield* Console.log(`Unregistered ${id}; its files are untouched`);
      }),
    ).pipe(Command.withDescription("Forget a workspace without touching its files")),
  ]),
);

const listsCommand = Command.make("lists").pipe(
  Command.withDescription("Manage lists"),
  Command.withSubcommands([
    Command.make(
      "create",
      {
        name: Argument.String("name"),
        parent: Flag.String("parent").pipe(Flag.optional),
      },
      Effect.fn(function* ({ name, parent }) {
        const created = yield* (yield* workspace).createList({
          name,
          parent: optional(parent) ?? null,
        });
        yield* Console.log(`Created list ${created.id} in ${created.folder}`);
      }),
    ).pipe(Command.withDescription("Create a list folder, last among its siblings")),
    Command.make(
      "move",
      {
        id: Argument.String("id").pipe(Argument.withDescription("List id, e.g. garden/seeds")),
        parent: Flag.String("parent").pipe(
          Flag.withDescription("List to nest it under"),
          Flag.optional,
        ),
        topLevel: Flag.Boolean("top-level").pipe(
          Flag.withDescription("Move it out of its parent list"),
          Flag.withDefault(false),
        ),
        before: Flag.String("before").pipe(Flag.optional),
        after: Flag.String("after").pipe(Flag.optional),
      },
      Effect.fn(function* (options) {
        const moved = yield* (yield* workspace).moveList(options.id, {
          ...(options.topLevel
            ? { parent: null }
            : Option.isSome(options.parent)
              ? { parent: options.parent.value }
              : {}),
          ...(Option.isSome(options.before) ? { before: options.before.value } : {}),
          ...(Option.isSome(options.after) ? { after: options.after.value } : {}),
        });
        yield* Console.log(`Moved list ${moved.id} to ${moved.folder}`);
      }),
    ).pipe(Command.withDescription("Reorder a list or move it under another list")),
  ]),
);

const serveCommand = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(Flag.withDefault(DEFAULT_PORT)),
    webDir: Flag.String("web-dir").pipe(
      Flag.withDescription("Built web app to serve"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (options) {
    const defaultWeb = fileURLToPath(new URL("../../../apps/web/dist", import.meta.url));
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startServer({
          home,
          port: options.port,
          webDir: optional(options.webDir) ?? defaultWeb,
        }),
      ),
      (running) => Effect.promise(() => running.close()),
    );
    yield* Console.log(`octodo on ${server.url}`);
    yield* Console.log(`MCP: ${server.mcpUrl}`);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(Command.withDescription("Serve the web app, API and MCP endpoint"));

const mcpCommand = Command.make(
  "mcp",
  {},
  Effect.fn(function* () {
    const root = yield* octo;
    const defaultDir = Option.getOrElse(root.workspace, () => process.cwd());
    return yield* Layer.launch(
      stdioLayer({ defaultDir }).pipe(Layer.provide(Workspaces.layer({ home, watch: true }))),
    );
  }),
).pipe(Command.withDescription("Run the MCP server over stdio, for agents"));

const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Agent skills"),
  Command.withSubcommands([
    Command.make(
      "export",
      {
        dir: Flag.String("dir").pipe(
          Flag.withDescription("Skills folder"),
          Flag.withDefault(".agents/skills"),
        ),
      },
      Effect.fn(function* ({ dir }) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const target = path.join(dir, "octodo");
        yield* fs.makeDirectory(target, { recursive: true });
        yield* fs.writeFileString(path.join(target, "SKILL.md"), SKILL);
        yield* Console.log(`Wrote ${path.join(target, "SKILL.md")}`);
      }),
    ).pipe(
      Command.withDescription(
        "Write the octodo skill so agents in this project know how to use it",
      ),
    ),
  ]),
);

const fail = (message: string) =>
  Effect.andThen(
    Console.error(message),
    Effect.sync(() => (process.exitCode = 1)),
  );

octo.pipe(
  Command.withSubcommands([
    listCommand,
    showCommand,
    createCommand,
    updateCommand,
    moveCommand,
    deleteCommand,
    doctorCommand,
    initCommand,
    workspaceCommand,
    listsCommand,
    serveCommand,
    mcpCommand,
    skillsCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.catchTags({
    TaskNotFound: (error) => fail(error.message),
    WorkspaceNotFound: (error) => fail(`${error.message}. Run \`octo init\` or pass --workspace.`),
    InvalidRequest: (error) => fail(error.message),
    StorageError: (error) => fail(`${error.message}: ${String(error.cause)}`),
  }),
  Effect.provide(Workspaces.layer({ home, watch: false })),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
