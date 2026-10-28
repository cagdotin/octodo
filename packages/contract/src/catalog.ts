/**
 * Every operation octodo offers, declared once (decision 0005). MCP tools, CLI commands and the
 * agent skill are generated from these entries; the engine binds each name to its handler.
 */
import { Schema } from "effect";
import {
  AttachmentNotFound,
  AttachmentTooLarge,
  CreateListInput,
  CreateTaskInput,
  Diagnostic,
  DueDate,
  FixRequest,
  FixResult,
  InvalidRequest,
  List,
  MoveListInput,
  MoveTaskInput,
  PluginInfo,
  StorageError,
  WorkspaceBusy,
  Task,
  TaskDetail,
  TaskNotFound,
  TaskSummary,
  UpdateTaskInput,
  WorkspaceInfo,
  WorkspaceKey,
  WorkspaceNotFound,
  WorkspaceOverview,
} from "./domain.ts";
import { DEFAULT_PRESET, PRESET_IDS, PRESETS } from "./presets.ts";

/** How a field of an operation's input appears on the command line, beyond its name and type. */
export const CliField = Schema.Struct({
  /** An argument taken by position, in field order, instead of a `--flag`. */
  positional: Schema.optionalKey(Schema.Boolean),
  /** A one-letter short form: `p` for `-p`. */
  alias: Schema.optionalKey(Schema.String),
  /** The help of `--no-<name>`, which sets a nullable field to null. */
  clear: Schema.optionalKey(Schema.String),
});
export type CliField = typeof CliField.Type;

export const CLI_ANNOTATION = "octodo/cli";

/** Annotations for a field: `title: Schema.NonEmptyString.annotate(cli({ positional: true }))`. */
export const cli = (field: CliField) => ({ [CLI_ANNOTATION]: field });

/** The success of an operation that answers with a file's bytes rather than a value. */
export const FileSuccess = { _tag: "File" } as const;
export type FileSuccess = typeof FileSuccess;

export interface Http {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Relative to `/api`. Each `:name` segment is the input field `name`; the rest is the body or query. */
  readonly path: `/${string}`;
}

export interface CliCommand {
  /** The words that run it: `["lists", "create"]` is `octo lists create`. */
  readonly command: readonly [string, ...Array<string>];
  readonly description: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly examples?: ReadonlyArray<{ readonly command: string; readonly description: string }>;
}

export interface Operation {
  readonly description: string;
  readonly readonly: boolean;
  readonly destructive?: boolean;
  /** Whether repeating a call with the same input changes nothing more. */
  readonly idempotent?: boolean;
  /** One flat struct. A `workspace` field makes the operation run in one workspace. */
  readonly input: Schema.Struct<Schema.Struct.Fields>;
  readonly success: Schema.Top | FileSuccess;
  readonly error: Schema.Top;
  readonly http: Http;
  /** Without it the operation has no command of its own: `octo doctor` covers the diagnostics. */
  readonly cli?: CliCommand;
}

const WorkspaceField = Schema.optionalKey(Schema.String).annotate({
  description:
    "Registered workspace id or absolute folder path. Over stdio (octo mcp) omit it to use the workspace containing the folder the server started in; over HTTP it is required.",
});

const TaskId = Schema.String.annotate({
  description: "Task id, e.g. HM-42",
  ...cli({ positional: true }),
});

const presetList = PRESET_IDS.map(
  (id) => `${id} (${PRESETS[id].description.split(". ")[0]!.replace(/\.$/, "")})`,
).join("; ");

const PluginId = Schema.String.annotate({
  description: "Plugin id, e.g. recurring; list_plugins lists them",
  ...cli({ positional: true }),
});

const pluginsOfWorkspace = Schema.Array(Schema.String).annotate({
  description: "The plugins the workspace enables now",
});

const listId = "List id, e.g. groceries or garden/seeds";
const parentTask = "Parent task id, making this a subtask";

/** The errors of an operation in a workspace: finding the workspace and reading it can fail too. */
export const inWorkspace = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union([WorkspaceNotFound, StorageError, WorkspaceBusy, ...errors]);

export const catalog = {
  list_workspaces: {
    description: "List the workspaces registered on this machine.",
    readonly: true,
    input: Schema.Struct({}),
    success: Schema.Array(WorkspaceInfo),
    error: StorageError,
    http: { method: "GET", path: "/workspaces" },
    cli: { command: ["workspace", "list"], description: "List registered workspaces" },
  },
  add_workspace: {
    description: `Create a workspace in a folder and register it on this machine: octodo writes .octodo/config.json there with the statuses and plugins of a preset, ${DEFAULT_PRESET} unless preset names another. A folder that already holds a workspace is registered as it is, and name, key and preset are ignored.`,
    readonly: false,
    destructive: false,
    idempotent: true,
    input: Schema.Struct({
      // A relative path would resolve against the directory of whichever process runs it.
      root: Schema.String.pipe(
        Schema.check(Schema.isPattern(/^\//, { message: "Use an absolute folder path" })),
      ).annotate({ description: "Absolute path of the folder" }),
      name: Schema.optionalKey(Schema.String).annotate({
        description: "Workspace name; the folder's name when omitted",
      }),
      key: Schema.optionalKey(WorkspaceKey).annotate({
        description: "Id prefix, e.g. HM for HM-1; made from the name when omitted",
      }),
      preset: Schema.optionalKey(Schema.Literals(PRESET_IDS)).annotate({
        description: `What it starts with: ${presetList}`,
      }),
    }),
    success: WorkspaceInfo,
    error: Schema.Union([InvalidRequest, StorageError, WorkspaceBusy]),
    http: { method: "POST", path: "/workspaces" },
  },
  get_workspace: {
    description:
      "Describe a workspace: its statuses (in order), lists, task counts and any files it could not read.",
    readonly: true,
    input: Schema.Struct({ workspace: WorkspaceField }),
    success: WorkspaceOverview,
    error: inWorkspace(),
    http: { method: "GET", path: "/workspaces/:workspace/overview" },
  },
  list_tasks: {
    description:
      "List tasks in board order (by status, then their order), optionally filtered. Leaves out tasks in closed statuses unless all is true or status names one. Returns summaries without bodies; use get_task for the full task.",
    readonly: true,
    input: Schema.Struct({
      workspace: WorkspaceField,
      status: Schema.optionalKey(Schema.String).annotate(cli({ alias: "s" })),
      list: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
        description: "List id such as groceries or garden/seeds; null for tasks outside any list.",
        ...cli({ alias: "l", clear: "Only tasks outside any list" }),
      }),
      parent: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
        description: "Task id to list its subtasks; null for top-level tasks only.",
        ...cli({ clear: "Only top-level tasks" }),
      }),
      tag: Schema.optionalKey(Schema.String).annotate(cli({ alias: "t" })),
      query: Schema.optionalKey(Schema.String).annotate({
        description: "Case-insensitive text to find in title or body.",
      }),
      ready: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Only tasks that can start now: open and not blocked",
      }),
      due_by: Schema.optionalKey(DueDate).annotate({
        description:
          "Only tasks due on or before this day, YYYY-MM-DD, overdue ones included: today's date for what is due today, as the app's Today lists it. A plain task is due on its due; a recurring task on its next day, an anniversary on its next occurrence, and a days-since counter never.",
      }),
      all: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Include tasks in closed statuses (done, canceled, archived)",
        ...cli({ alias: "a" }),
      }),
    }),
    success: Schema.Array(TaskSummary),
    error: inWorkspace(),
    http: { method: "GET", path: "/workspaces/:workspace/tasks" },
    cli: {
      command: ["list"],
      aliases: ["ls"],
      description: "List open tasks in board order",
      examples: [
        { command: "octo list", description: "Open tasks, subtasks under their parent" },
        { command: "octo list --ready", description: "Open tasks that are not blocked" },
        {
          command: "octo list --due-by 2026-11-01",
          description: "Open tasks due by November 1, overdue ones and chores included",
        },
      ],
    },
  },
  get_task: {
    description:
      "Read one task, including its markdown body, any extra frontmatter, its parent, its direct subtasks, the tasks it is blocked by and blocks, the tasks it mentions and is mentioned in, and its attachments (read one with read_attachment).",
    readonly: true,
    input: Schema.Struct({ workspace: WorkspaceField, id: TaskId }),
    success: TaskDetail,
    error: inWorkspace(TaskNotFound),
    http: { method: "GET", path: "/workspaces/:workspace/tasks/:id" },
    cli: {
      command: ["show"],
      description: "Show one task with its subtasks, attachments and body",
      examples: [{ command: "octo show HM-42", description: "One task" }],
    },
  },
  read_attachment: {
    description:
      "Read one of a task's attachments by its path in the task folder, as get_task lists it. An image comes back as an image, a text file as text, anything else as an embedded file. Files larger than 20 MB are refused.",
    readonly: true,
    input: Schema.Struct({
      workspace: WorkspaceField,
      id: TaskId,
      path: Schema.String.annotate({
        description: "The attachment's path in the task folder, e.g. images/plan.png",
        ...cli({ positional: true }),
      }),
    }),
    success: FileSuccess,
    error: inWorkspace(TaskNotFound, InvalidRequest, AttachmentNotFound, AttachmentTooLarge),
    http: { method: "GET", path: "/workspaces/:workspace/tasks/:id/files/:path" },
    cli: {
      command: ["attachment"],
      description: "Write one of a task's attachments to stdout, or to the file --output names",
      examples: [
        {
          command: "octo attachment HM-42 images/plan.png --output plan.png",
          description: "Save an attachment",
        },
      ],
    },
  },
  create_task: {
    description:
      "Create a task. Without a status it goes to the first unstarted status (usually todo). parent makes it a subtask of that task id; give a list or a parent, not both.",
    readonly: false,
    destructive: false,
    input: Schema.Struct({
      workspace: WorkspaceField,
      ...CreateTaskInput.fields,
      title: CreateTaskInput.fields.title.annotate(cli({ positional: true })),
      status: CreateTaskInput.fields.status.annotate(cli({ alias: "s" })),
      list: CreateTaskInput.fields.list.annotate({
        description: listId,
        ...cli({ alias: "l", clear: "In no list" }),
      }),
      parent: CreateTaskInput.fields.parent.annotate({
        description: parentTask,
        ...cli({ clear: "Not a subtask" }),
      }),
      priority: CreateTaskInput.fields.priority.annotate(cli({ alias: "p" })),
      tags: CreateTaskInput.fields.tags.annotate({ description: "Tags", ...cli({ alias: "t" }) }),
      due: CreateTaskInput.fields.due.annotate({
        description: "Due date, YYYY-MM-DD",
        ...cli({ clear: "No due date" }),
      }),
      body: CreateTaskInput.fields.body.annotate({ description: "Markdown body" }),
    }),
    success: Task,
    error: inWorkspace(InvalidRequest),
    http: { method: "POST", path: "/workspaces/:workspace/tasks" },
    cli: {
      command: ["create"],
      aliases: ["add"],
      description: "Create a task",
      examples: [
        {
          command: 'octo create "Book the movers" -p high -t quotes',
          description: "A high-priority task",
        },
        { command: 'octo create "Buy primer" --parent HM-12', description: "A subtask of HM-12" },
      ],
    },
  },
  update_task: {
    description:
      "Change a task's title, priority, tags, due date (YYYY-MM-DD, null clears it), markdown body or blocked_by (the task ids it waits for, replacing the current ones; [] clears them). Returns the task as get_task does. Use move_task to change status or list.",
    readonly: false,
    destructive: false,
    idempotent: true,
    input: Schema.Struct({
      workspace: WorkspaceField,
      id: TaskId,
      ...UpdateTaskInput.fields,
      priority: UpdateTaskInput.fields.priority.annotate(cli({ alias: "p" })),
      tags: UpdateTaskInput.fields.tags.annotate({
        description: "Tags, replacing the current ones",
        ...cli({ alias: "t" }),
      }),
      due: UpdateTaskInput.fields.due.annotate({
        description: "Due date, YYYY-MM-DD",
        ...cli({ clear: "Remove the due date" }),
      }),
      body: UpdateTaskInput.fields.body.annotate({ description: "Markdown body" }),
      blocked_by: UpdateTaskInput.fields.blocked_by.annotate({
        description: "Task ids it waits for, replacing the current ones; empty clears them",
      }),
    }),
    success: TaskDetail,
    error: inWorkspace(TaskNotFound, InvalidRequest),
    http: { method: "PATCH", path: "/workspaces/:workspace/tasks/:id" },
    cli: {
      command: ["update"],
      description: "Change a task's title, priority, tags, due date, body or blockers",
      examples: [
        { command: 'octo update HM-4 --body "Notes in markdown"', description: "A new body" },
        { command: "octo update HM-4 --blocked-by HM-2,HM-3", description: "HM-4 waits for both" },
        { command: "octo update HM-4 --blocked-by ''", description: "HM-4 waits for nothing" },
      ],
    },
  },
  move_task: {
    description:
      "Move a task to another status, list or parent task (a list or a parent, not both; parent null lifts a subtask into its list). before/after place it next to another task id; otherwise it goes last. A recurring task moved to a completed status logs that it was done and stays open, in the first unstarted status, until it is due again.",
    readonly: false,
    destructive: false,
    input: Schema.Struct({
      workspace: WorkspaceField,
      id: TaskId,
      ...MoveTaskInput.fields,
      status: MoveTaskInput.fields.status.annotate({
        description: "Target status, e.g. in-progress",
        ...cli({ positional: true }),
      }),
      list: MoveTaskInput.fields.list.annotate({
        description: listId,
        ...cli({ alias: "l", clear: "Move out of any list" }),
      }),
      parent: MoveTaskInput.fields.parent.annotate({
        description: parentTask,
        ...cli({ clear: "Lift a subtask out to its parent's list" }),
      }),
    }),
    success: Task,
    error: inWorkspace(TaskNotFound, InvalidRequest),
    http: { method: "POST", path: "/workspaces/:workspace/tasks/:id/move" },
    cli: {
      command: ["move"],
      description: "Move a task to another status, list or parent task",
      examples: [
        { command: "octo move HM-42 in-progress", description: "Change its status" },
        {
          command: "octo move HM-43 --parent HM-42",
          description: "Make it a subtask; --no-parent lifts it out",
        },
      ],
    },
  },
  delete_task: {
    description:
      "Delete a task's file permanently. Prefer moving it to an archived status unless deletion was asked for.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ workspace: WorkspaceField, id: TaskId }),
    success: Schema.Struct({ deleted: Schema.String }),
    error: inWorkspace(TaskNotFound),
    http: { method: "DELETE", path: "/workspaces/:workspace/tasks/:id" },
    cli: {
      command: ["delete"],
      description: "Delete a task's folder with its subtasks and attachments",
    },
  },
  create_list: {
    description: "Create a list, last among its siblings. parent is a list id to nest it under.",
    readonly: false,
    destructive: false,
    input: Schema.Struct({
      workspace: WorkspaceField,
      ...CreateListInput.fields,
      name: CreateListInput.fields.name.annotate(cli({ positional: true })),
      parent: CreateListInput.fields.parent.annotate({
        description: "List to nest it under",
        ...cli({ clear: "At the top level" }),
      }),
    }),
    success: List,
    error: inWorkspace(InvalidRequest),
    http: { method: "POST", path: "/workspaces/:workspace/lists" },
    cli: {
      command: ["lists", "create"],
      description: "Create a list folder, last among its siblings",
    },
  },
  move_list: {
    description:
      "Reorder a list among its siblings (before/after another list id) and/or move it under another parent (null for the top level). Moving to another parent changes its id.",
    readonly: false,
    destructive: false,
    input: Schema.Struct({
      workspace: WorkspaceField,
      id: Schema.String.annotate({
        description: "List id, e.g. garden/seeds",
        ...cli({ positional: true }),
      }),
      ...MoveListInput.fields,
      parent: MoveListInput.fields.parent.annotate({
        description: "List to nest it under",
        ...cli({ clear: "Move it out of its parent list" }),
      }),
    }),
    success: List,
    error: inWorkspace(InvalidRequest),
    // List ids contain slashes, so the id travels in the body rather than the path.
    http: { method: "POST", path: "/workspaces/:workspace/lists/move" },
    cli: {
      command: ["lists", "move"],
      description: "Reorder a list or move it under another list",
    },
  },
  list_diagnostics: {
    description:
      "List the problems with files in the workspace: each has a path, a kind, the frontmatter field at fault, a message saying what to do, and a fix when octodo can repair it.",
    readonly: true,
    input: Schema.Struct({ workspace: WorkspaceField }),
    success: Schema.Array(Diagnostic),
    error: inWorkspace(),
    http: { method: "GET", path: "/workspaces/:workspace/diagnostics" },
  },
  fix_diagnostic: {
    description:
      "Apply the fix of one diagnostic, given its path, kind and fix action from list_diagnostics. octodo reads the files again and applies it only if a fresh read still offers that fix there, so repeating a call is harmless and a stale one does nothing. Returns what it fixed and the diagnostics left. A remove-copy fix deletes a copy that is the same as the original.",
    readonly: false,
    destructive: true,
    idempotent: true,
    input: Schema.Struct({ workspace: WorkspaceField, ...FixRequest.fields }),
    success: FixResult,
    error: inWorkspace(),
    http: { method: "POST", path: "/workspaces/:workspace/diagnostics/fix" },
  },
  list_plugins: {
    description:
      "List the plugins octodo has, each a kind of task a workspace can enable: get_workspace says which ones it enables.",
    readonly: true,
    input: Schema.Struct({}),
    success: Schema.Array(PluginInfo),
    error: StorageError,
    http: { method: "GET", path: "/plugins" },
    cli: { command: ["plugins", "list"], description: "List the plugins octodo has" },
  },
  enable_plugin: {
    description:
      "Enable a plugin in a workspace, adding it to config.json's plugins. Its tasks read as tasks of its kind again, and its operations run there.",
    readonly: false,
    destructive: false,
    idempotent: true,
    input: Schema.Struct({ workspace: WorkspaceField, plugin: PluginId }),
    success: pluginsOfWorkspace,
    error: inWorkspace(InvalidRequest),
    http: { method: "PUT", path: "/workspaces/:workspace/plugins/:plugin" },
    cli: {
      command: ["plugins", "enable"],
      description: "Enable a plugin in the workspace",
      examples: [{ command: "octo plugins enable recurring", description: "Let tasks repeat" }],
    },
  },
  disable_plugin: {
    description:
      "Disable a plugin in a workspace, removing it from config.json's plugins. Its tasks stay as they are on disk and read as plain tasks, each with an unknown-kind diagnostic, until it is enabled again.",
    readonly: false,
    destructive: false,
    idempotent: true,
    input: Schema.Struct({ workspace: WorkspaceField, plugin: PluginId }),
    success: pluginsOfWorkspace,
    error: inWorkspace(InvalidRequest),
    http: { method: "DELETE", path: "/workspaces/:workspace/plugins/:plugin" },
    cli: { command: ["plugins", "disable"], description: "Disable a plugin in the workspace" },
  },
} satisfies Record<string, Operation>;

export type Catalog = typeof catalog;
export type OperationName = keyof Catalog;

/** Whether an operation runs in one workspace, which every surface picks in its own way. */
export const inOneWorkspace = (operation: Operation): boolean =>
  "workspace" in operation.input.fields;

/** The input fields an HTTP path names, in order: `["workspace", "id"]`. */
export const pathParams = (http: Http): Array<string> =>
  http.path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));
