import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Priority, Workspaces, defaultHome, type Task } from "@octodo/core";
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
const taskId = Argument.String("id").pipe(Argument.withDescription("Task id, e.g. CT-42"));

/** The workspace named by `--workspace`, or the one containing the current directory. */
const workspace = Effect.gen(function* () {
  const root = yield* octo;
  const workspaces = yield* Workspaces;
  return yield* Option.match(root.workspace, {
    onNone: () => workspaces.resolve(process.cwd()),
    onSome: (target) =>
      target.includes("/") || target === "." ? workspaces.resolve(target) : workspaces.get(target),
  });
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
  ]
    .filter((part) => part !== "")
    .join("  ");

const print = (task: Task, asJson: boolean) =>
  asJson ? Console.log(JSON.stringify(task, null, 2)) : Console.log(line(task));

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
    json,
  },
  Effect.fn(function* (options) {
    const snapshot = yield* (yield* workspace).snapshot;
    const closed = new Set(
      snapshot.statuses
        .filter((status) => ["completed", "canceled", "archived"].includes(status.category))
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
          (Option.isNone(options.tag) || task.tags.includes(options.tag.value)),
      )
      .toSorted((a, b) => (order.get(a.status) ?? 0) - (order.get(b.status) ?? 0));
    if (options.json) return yield* Console.log(JSON.stringify(tasks, null, 2));
    if (tasks.length === 0) return yield* Console.log("No tasks");
    for (const task of tasks) yield* Console.log(line(task));
    for (const diagnostic of snapshot.diagnostics)
      yield* Console.error(`warning: ${diagnostic.path}: ${diagnostic.message}`);
  }),
).pipe(Command.withDescription("List open tasks in board order"), Command.withAlias("ls"));

const showCommand = Command.make(
  "show",
  { id: taskId, json },
  Effect.fn(function* ({ id, json: asJson }) {
    const task = yield* (yield* workspace).getTask(id);
    if (asJson) return yield* print(task, true);
    yield* Console.log(line(task));
    yield* Console.log(`path: ${task.path}`);
    if (task.body.length > 0) yield* Console.log(`\n${task.body.trimEnd()}`);
  }),
).pipe(Command.withDescription("Show one task with its body"));

const createCommand = Command.make(
  "create",
  {
    title: Argument.String("title"),
    status: Flag.String("status").pipe(Flag.withAlias("s"), Flag.optional),
    list,
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
      command: 'octo create "Reconcile Kraken trades" -p high -t exchange',
      description: "A high-priority task",
    },
  ]),
);

const updateCommand = Command.make(
  "update",
  { id: taskId, title: Flag.String("title").pipe(Flag.optional), priority, tags, due, body, json },
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
    });
    yield* print(task, options.json);
  }),
).pipe(Command.withDescription("Change a task's title, priority, tags, due date or body"));

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
      ...(Option.isSome(options.before) ? { before: options.before.value } : {}),
      ...(Option.isSome(options.after) ? { after: options.after.value } : {}),
    });
    yield* print(task, options.json);
  }),
).pipe(Command.withDescription("Move a task to another status or list"));

const deleteCommand = Command.make(
  "delete",
  { id: taskId },
  Effect.fn(function* ({ id }) {
    yield* (yield* workspace).deleteTask(id);
    yield* Console.log(`Deleted ${id}`);
  }),
).pipe(Command.withDescription("Delete a task's file"));

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
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "Interface to bind; 0.0.0.0 or a Tailscale IP to reach it from other devices",
      ),
      Flag.withDefault("127.0.0.1"),
    ),
    port: Flag.Int("port").pipe(Flag.withDefault(DEFAULT_PORT)),
    allowHost: Flag.String("allow-host").pipe(
      Flag.withDescription("Extra Host name to accept, e.g. mac.tailnet.ts.net"),
      Flag.atLeast(0),
    ),
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
          host: options.host,
          port: options.port,
          allowedHosts: options.allowHost,
          webDir: optional(options.webDir) ?? defaultWeb,
        }),
      ),
      (running) => Effect.promise(() => running.close()),
    );
    yield* Console.log(`octodo on ${server.url}`);
    yield* Console.log(`Open and pair: ${server.pairUrl}`);
    yield* Console.log(
      `MCP: ${server.mcpUrl} (Authorization: Bearer <token from ${home}/server.json>)`,
    );
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

octo.pipe(
  Command.withSubcommands([
    listCommand,
    showCommand,
    createCommand,
    updateCommand,
    moveCommand,
    deleteCommand,
    initCommand,
    workspaceCommand,
    listsCommand,
    serveCommand,
    mcpCommand,
    skillsCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.catchTags({
    TaskNotFound: (error) =>
      Effect.andThen(
        Console.error(`No task with id ${error.id}`),
        Effect.sync(() => (process.exitCode = 1)),
      ),
    WorkspaceNotFound: (error) =>
      Effect.andThen(
        Console.error(
          `No workspace for ${error.workspace}. Run \`octo init\` or pass --workspace.`,
        ),
        Effect.sync(() => (process.exitCode = 1)),
      ),
    InvalidRequest: (error) =>
      Effect.andThen(
        Console.error(error.message),
        Effect.sync(() => (process.exitCode = 1)),
      ),
    StorageError: (error) =>
      Effect.andThen(
        Console.error(`${error.message}: ${String(error.cause)}`),
        Effect.sync(() => (process.exitCode = 1)),
      ),
  }),
  Effect.provide(Workspaces.layer({ home, watch: false })),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
