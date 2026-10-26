import {
  CreateTaskInput,
  List,
  MoveTaskInput,
  Priority,
  StatusDefinition,
  Task,
  UpdateTaskInput,
  WorkspaceInfo,
  Workspaces,
  type Workspace,
} from "@tasksmd/core";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";

export const SERVER_NAME = "tasksmd";

export const INSTRUCTIONS = `tasksmd manages tasks stored as markdown files with YAML frontmatter under a project's .tasks/ folder.
- A folder named s-<status> holds the tasks in that status; moving a task between statuses moves its file.
- Folders named c-<name> (category) or p-<name> (project) are lists; their status folders hold their tasks.
- Every task has a stable id like CT-42 (the workspace key plus a number). Refer to tasks by id, never by path.
- Call get_workspace first to learn the statuses and lists before creating or moving tasks.
- The workspace parameter takes a registered workspace id or an absolute folder path; omit it to use the workspace containing the server's working directory.`;

const ToolFailure = Schema.Struct({ error: Schema.String });

const WorkspaceParam = Schema.optionalKey(Schema.String).annotate({
  description: "Registered workspace id or absolute path. Omit to use the current project.",
});

const TaskSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  list: Schema.NullOr(Schema.String),
  priority: Priority,
  tags: Schema.Array(Schema.String),
  due: Schema.NullOr(Schema.String),
});

const ListWorkspaces = Tool.make("list_workspaces", {
  description: "List the workspaces registered on this machine.",
  success: Schema.Array(WorkspaceInfo),
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const GetWorkspace = Tool.make("get_workspace", {
  description:
    "Describe a workspace: its statuses (in order), lists, task counts and any files it could not read.",
  parameters: Schema.Struct({ workspace: WorkspaceParam }),
  success: Schema.Struct({
    workspace: WorkspaceInfo,
    statuses: Schema.Array(Schema.Struct({ ...StatusDefinition.fields, count: Schema.Number })),
    lists: Schema.Array(Schema.Struct({ ...List.fields, count: Schema.Number })),
    diagnostics: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
  }),
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ListTasks = Tool.make("list_tasks", {
  description:
    "List tasks in board order, optionally filtered. Returns summaries without bodies; use get_task for the full task.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    status: Schema.optionalKey(Schema.String),
    list: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
      description: "List id such as c-groceries; null for tasks outside any list.",
    }),
    tag: Schema.optionalKey(Schema.String),
    query: Schema.optionalKey(Schema.String).annotate({
      description: "Case-insensitive text to find in title or body.",
    }),
  }),
  success: Schema.Array(TaskSummary),
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const GetTask = Tool.make("get_task", {
  description: "Read one task, including its markdown body and any extra frontmatter.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, id: Schema.String }),
  success: Task,
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CreateTask = Tool.make("create_task", {
  description:
    "Create a task. Without a status it goes to the first unstarted status (usually todo).",
  parameters: Schema.Struct({ workspace: WorkspaceParam, ...CreateTaskInput.fields }),
  success: Task,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

const UpdateTask = Tool.make("update_task", {
  description:
    "Change a task's title, priority, tags, due date (YYYY-MM-DD, null clears it) or markdown body. Use move_task to change status or list.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    id: Schema.String,
    ...UpdateTaskInput.fields,
  }),
  success: Task,
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const MoveTask = Tool.make("move_task", {
  description:
    "Move a task to another status and/or list. before/after place it next to another task id; otherwise it goes last.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    id: Schema.String,
    ...MoveTaskInput.fields,
  }),
  success: Task,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

const DeleteTask = Tool.make("delete_task", {
  description:
    "Delete a task's file permanently. Prefer moving it to an archived status unless deletion was asked for.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, id: Schema.String }),
  success: Schema.Struct({ deleted: Schema.String }),
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, true);

const CreateList = Tool.make("create_list", {
  description:
    "Create a list folder. kind is the folder prefix: c for a category, p for a project.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    name: Schema.NonEmptyString,
    kind: Schema.String,
    parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  success: List,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

export const TasksToolkit = Toolkit.make(
  ListWorkspaces,
  GetWorkspace,
  ListTasks,
  GetTask,
  CreateTask,
  UpdateTask,
  MoveTask,
  DeleteTask,
  CreateList,
);

const toFailure = (error: { readonly _tag: string; readonly message?: string }) => {
  switch (error._tag) {
    case "TaskNotFound":
      return { error: `No task with id ${(error as { id?: string }).id}` };
    case "WorkspaceNotFound":
      return { error: `No workspace found for ${(error as { workspace?: string }).workspace}` };
    default:
      return { error: error.message ?? error._tag };
  }
};

/**
 * Tool handlers. `defaultDir` is where a call without a `workspace` looks for one: the directory
 * the stdio server was started in, or none over HTTP, where the caller has no meaningful cwd.
 */
export const toolkitLayer = (options: { readonly defaultDir?: string | undefined }) =>
  TasksToolkit.toLayer(
    Effect.gen(function* () {
      const workspaces = yield* Workspaces;

      const open = (workspace: string | undefined): Effect.Effect<Workspace, { error: string }> => {
        const target = workspace ?? options.defaultDir;
        if (target === undefined) {
          return Effect.fail({ error: "Pass a workspace: call list_workspaces to see them" });
        }
        const lookup = target.startsWith("/") ? workspaces.resolve(target) : workspaces.get(target);
        return Effect.mapError(lookup, toFailure);
      };

      return TasksToolkit.of({
        list_workspaces: () => Effect.mapError(workspaces.list, toFailure),
        get_workspace: ({ workspace }) =>
          Effect.gen(function* () {
            const ws = yield* open(workspace);
            const snapshot = yield* Effect.mapError(ws.snapshot, toFailure);
            const count = (predicate: (task: Task) => boolean) =>
              snapshot.tasks.filter(predicate).length;
            return {
              workspace: snapshot.workspace,
              statuses: snapshot.statuses.map((status) => ({
                ...status,
                count: count((task) => task.status === status.id),
              })),
              lists: snapshot.lists.map((list) => ({
                ...list,
                count: count((task) => task.list === list.id),
              })),
              diagnostics: snapshot.diagnostics,
            };
          }),
        list_tasks: ({ workspace, status, list, tag, query }) =>
          Effect.gen(function* () {
            const ws = yield* open(workspace);
            const snapshot = yield* Effect.mapError(ws.snapshot, toFailure);
            const needle = query?.toLowerCase();
            return snapshot.tasks
              .filter(
                (task) =>
                  (status === undefined || task.status === status) &&
                  (list === undefined || task.list === list) &&
                  (tag === undefined || task.tags.includes(tag)) &&
                  (needle === undefined ||
                    task.title.toLowerCase().includes(needle) ||
                    task.body.toLowerCase().includes(needle)),
              )
              .map(({ id, title, status, list, priority, tags, due }) => ({
                id,
                title,
                status,
                list,
                priority,
                tags,
                due,
              }));
          }),
        get_task: ({ workspace, id }) =>
          Effect.flatMap(open(workspace), (ws) => Effect.mapError(ws.getTask(id), toFailure)),
        create_task: ({ workspace, ...input }) =>
          Effect.flatMap(open(workspace), (ws) => Effect.mapError(ws.createTask(input), toFailure)),
        update_task: ({ workspace, id, ...input }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(ws.updateTask(id, input), toFailure),
          ),
        move_task: ({ workspace, id, ...input }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(ws.moveTask(id, input), toFailure),
          ),
        delete_task: ({ workspace, id }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(Effect.as(ws.deleteTask(id), { deleted: id }), toFailure),
          ),
        create_list: ({ workspace, ...input }) =>
          Effect.flatMap(open(workspace), (ws) => Effect.mapError(ws.createList(input), toFailure)),
      });
    }),
  );

const serverOptions = {
  name: SERVER_NAME,
  version: "0.0.0",
  instructions: INSTRUCTIONS,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26] as const,
};

const registerTools = (options: { readonly defaultDir?: string | undefined }) =>
  McpServer.toolkit(TasksToolkit).pipe(Layer.provide(toolkitLayer(options)));

/** MCP over stdio, for agents that launch `tasksmd mcp` as a subprocess. Requires `Stdio` and `Workspaces`. */
export const stdioLayer = (options: { readonly defaultDir?: string | undefined }) =>
  registerTools(options).pipe(Layer.provide(McpServer.layerStdio(serverOptions)));

/** Streamable HTTP MCP endpoint registered on an `HttpRouter`. Requires `Workspaces`. */
export const httpLayer = (options: {
  readonly path: `/${string}`;
  readonly allowedOrigins?: ReadonlyArray<string>;
}) =>
  registerTools({}).pipe(
    Layer.provide(
      McpServer.layerHttp({
        ...serverOptions,
        path: options.path,
        ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      }),
    ),
  );
