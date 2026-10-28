import {
  CreateListInput,
  CreateTaskInput,
  Diagnostic,
  FixRequest,
  FixResult,
  List,
  MoveListInput,
  MoveTaskInput,
  Priority,
  StatusDefinition,
  Task,
  UpdateTaskInput,
  WorkspaceInfo,
  Workspaces,
  isReady,
  type Workspace,
  type WorkspaceSnapshot,
} from "@octodo/core";
import { Effect, Layer, Logger, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";

export const SERVER_NAME = "octodo";

export const INSTRUCTIONS = `octodo manages tasks stored as markdown files under a project's .octodo/ folder. Use these tools to change them rather than editing files.
- Every task is a folder holding task.md, whose frontmatter has its id, title, status, priority, tags, due date and order. Other files in the folder are its attachments.
- A task folder inside another task is a subtask: create_task and move_task take a parent task id, and get_task lists a task's subtasks.
- Folders with list.md are lists, nested up to 3 levels. List ids are folder names joined by slashes: garden/seeds.
- Every task has a stable id like HM-42 (the workspace key plus a number). Refer to tasks by id, never by path.
- blocked_by in a task's frontmatter lists the task ids it waits for. A task is blocked while any of them is open or missing; update_task sets blocked_by, and list_tasks with ready: true lists open tasks that are not blocked. [[HM-3]] in a body mentions task HM-3.
- Call get_workspace first to learn the statuses and lists before creating or moving tasks.
- Files that octodo cannot read cleanly show up as diagnostics (list_diagnostics). Fix one with fix_diagnostic when it offers a fix; otherwise tell the user what its message says to do. Never edit the files to fix them.
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
  parent: Schema.NullOr(Schema.String),
  priority: Priority,
  tags: Schema.Array(Schema.String),
  due: Schema.NullOr(Schema.String),
  blocked: Schema.Boolean,
});

/** Another task named by a link, with a null title and status when no task has its id. */
const TaskRef = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
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
    diagnostics: Schema.Array(Diagnostic),
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
      description: "List id such as groceries or garden/seeds; null for tasks outside any list.",
    }),
    parent: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
      description: "Task id to list its subtasks; null for top-level tasks only.",
    }),
    tag: Schema.optionalKey(Schema.String),
    query: Schema.optionalKey(Schema.String).annotate({
      description: "Case-insensitive text to find in title or body.",
    }),
    ready: Schema.optionalKey(Schema.Boolean).annotate({
      description: "true: only tasks that can start now, open and not blocked.",
    }),
  }),
  success: Schema.Array(TaskSummary),
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

/** A task with the tasks it links to as id, title and status, and its direct subtasks. */
const TaskDetail = Schema.Struct({
  ...Task.fields,
  blockedBy: Schema.Array(TaskRef),
  blocks: Schema.Array(TaskRef),
  mentions: Schema.Array(TaskRef),
  mentionedIn: Schema.Array(TaskRef),
  subtasks: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String, status: Schema.String }),
  ),
});

const GetTask = Tool.make("get_task", {
  description:
    "Read one task, including its markdown body, any extra frontmatter, its parent, its direct subtasks, the tasks it is blocked by and blocks, and the tasks it mentions and is mentioned in.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, id: Schema.String }),
  success: TaskDetail,
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CreateTask = Tool.make("create_task", {
  description:
    "Create a task. Without a status it goes to the first unstarted status (usually todo). parent makes it a subtask of that task id; give a list or a parent, not both.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, ...CreateTaskInput.fields }),
  success: Task,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

const UpdateTask = Tool.make("update_task", {
  description:
    "Change a task's title, priority, tags, due date (YYYY-MM-DD, null clears it), markdown body or blocked_by (the task ids it waits for, replacing the current ones; [] clears them). Returns the task as get_task does. Use move_task to change status or list.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    id: Schema.String,
    ...UpdateTaskInput.fields,
  }),
  success: TaskDetail,
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const MoveTask = Tool.make("move_task", {
  description:
    "Move a task to another status, list or parent task (a list or a parent, not both; parent null lifts a subtask into its list). before/after place it next to another task id; otherwise it goes last.",
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
  description: "Create a list, last among its siblings. parent is a list id to nest it under.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, ...CreateListInput.fields }),
  success: List,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

const MoveList = Tool.make("move_list", {
  description:
    "Reorder a list among its siblings (before/after another list id) and/or move it under another parent (null for the top level). Moving to another parent changes its id.",
  parameters: Schema.Struct({
    workspace: WorkspaceParam,
    id: Schema.String,
    ...MoveListInput.fields,
  }),
  success: List,
  failure: ToolFailure,
  failureMode: "return",
}).annotate(Tool.Destructive, false);

const ListDiagnostics = Tool.make("list_diagnostics", {
  description:
    "List the problems with files in the workspace: each has a path, a kind, the frontmatter field at fault, a message saying what to do, and a fix when octodo can repair it.",
  parameters: Schema.Struct({ workspace: WorkspaceParam }),
  success: Schema.Array(Diagnostic),
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const FixDiagnostic = Tool.make("fix_diagnostic", {
  description:
    "Apply the fix of one diagnostic, given its path, kind and fix action from list_diagnostics. octodo reads the files again and applies it only if a fresh read still offers that fix there, so repeating a call is harmless and a stale one does nothing. Returns what it fixed and the diagnostics left. A remove-copy fix deletes a copy that is the same as the original.",
  parameters: Schema.Struct({ workspace: WorkspaceParam, ...FixRequest.fields }),
  success: FixResult,
  failure: ToolFailure,
  failureMode: "return",
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

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
  MoveList,
  ListDiagnostics,
  FixDiagnostic,
);

const toFailure = (error: { readonly message: string }) => ({ error: error.message });

const taskRefs = (snapshot: WorkspaceSnapshot, ids: ReadonlyArray<string>) =>
  ids.map((id) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === id);
    return { id, title: task?.title ?? null, status: task?.status ?? null };
  });

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
        return Effect.mapError(workspaces.open(target), toFailure);
      };

      const detail = (ws: Workspace, id: string) =>
        Effect.gen(function* () {
          const task = yield* ws.getTask(id);
          const snapshot = yield* ws.snapshot;
          const subtasks = snapshot.tasks
            .filter((candidate) => candidate.parent === id)
            .map(({ id, title, status }) => ({ id, title, status }));
          return {
            ...task,
            subtasks,
            blockedBy: taskRefs(snapshot, task.blockedBy),
            blocks: taskRefs(snapshot, task.blocks),
            mentions: taskRefs(snapshot, task.mentions),
            mentionedIn: taskRefs(snapshot, task.mentionedIn),
          };
        });

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
        list_tasks: ({ workspace, status, list, parent, tag, query, ready }) =>
          Effect.gen(function* () {
            const ws = yield* open(workspace);
            const snapshot = yield* Effect.mapError(ws.snapshot, toFailure);
            const needle = query?.toLowerCase();
            return snapshot.tasks
              .filter(
                (task) =>
                  (status === undefined || task.status === status) &&
                  (list === undefined || task.list === list) &&
                  (parent === undefined || task.parent === parent) &&
                  (tag === undefined || task.tags.includes(tag)) &&
                  (ready !== true || isReady(task, snapshot.statuses)) &&
                  (needle === undefined ||
                    task.title.toLowerCase().includes(needle) ||
                    task.body.toLowerCase().includes(needle)),
              )
              .map(({ id, title, status, list, parent, priority, tags, due, blocked }) => ({
                id,
                title,
                status,
                list,
                parent,
                priority,
                tags,
                due,
                blocked,
              }));
          }),
        get_task: ({ workspace, id }) =>
          Effect.flatMap(open(workspace), (ws) => Effect.mapError(detail(ws, id), toFailure)),
        create_task: ({ workspace, ...input }) =>
          Effect.flatMap(open(workspace), (ws) => Effect.mapError(ws.createTask(input), toFailure)),
        update_task: ({ workspace, id, ...input }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(Effect.andThen(ws.updateTask(id, input), detail(ws, id)), toFailure),
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
        move_list: ({ workspace, id, ...input }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(ws.moveList(id, input), toFailure),
          ),
        list_diagnostics: ({ workspace }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(
              Effect.map(ws.snapshot, (snapshot) => snapshot.diagnostics),
              toFailure,
            ),
          ),
        fix_diagnostic: ({ workspace, ...request }) =>
          Effect.flatMap(open(workspace), (ws) =>
            Effect.mapError(ws.fixDiagnostic(request), toFailure),
          ),
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

/**
 * MCP over stdio, for agents that launch `octo mcp` as a subprocess. Requires `Stdio` and
 * `Workspaces`. Logs go to stderr, since stdout carries the protocol.
 */
export const stdioLayer = (options: { readonly defaultDir?: string | undefined }) =>
  registerTools(options).pipe(
    Layer.provide(McpServer.layerStdio(serverOptions)),
    Layer.provide(Logger.layer([Logger.withConsoleError(Logger.formatSimple)])),
  );

/** Streamable HTTP MCP endpoint registered on an `HttpRouter`. Requires `Workspaces`. */
export const httpLayer = (options: { readonly path: `/${string}` }) =>
  registerTools({}).pipe(
    Layer.provide(McpServer.layerHttp({ ...serverOptions, path: options.path })),
  );
