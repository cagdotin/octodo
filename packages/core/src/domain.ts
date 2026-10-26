import { Schema } from "effect";

export const Priority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type Priority = typeof Priority.Type;

/**
 * What a status means, independent of its name. Views use it to decide what counts as open,
 * finished or hidden, and statuses are ordered by it: categories always come in this order, and
 * only the statuses inside one category are ordered by the user.
 */
export const STATUS_CATEGORIES = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "archived",
] as const;
export const StatusCategory = Schema.Literals(STATUS_CATEGORIES);
export type StatusCategory = typeof StatusCategory.Type;

export const StatusDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: StatusCategory,
});
export type StatusDefinition = typeof StatusDefinition.Type;

/**
 * `.octodo/config.json`. Unknown keys are kept when the app rewrites it. The order of `statuses`
 * within each category is the workflow order; the `s<NN>-` folder numbers mirror it.
 */
export const WorkspaceConfig = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  statuses: Schema.optionalKey(Schema.Array(StatusDefinition)),
});
export type WorkspaceConfig = typeof WorkspaceConfig.Type;

export const DEFAULT_STATUSES: ReadonlyArray<StatusDefinition> = [
  { id: "backlog", name: "Backlog", category: "backlog" },
  { id: "todo", name: "Todo", category: "unstarted" },
  { id: "in-progress", name: "In Progress", category: "started" },
  { id: "done", name: "Done", category: "completed" },
  { id: "archived", name: "Archived", category: "archived" },
];

/**
 * A list folder. Snapshots give lists depth first, each among its siblings in folder order, so a
 * tree can be built by walking the array once.
 */
export const List = Schema.Struct({
  /** The slugs from `.octodo/` down to the list, without folder numbers: `garden/seeds`. */
  id: Schema.String,
  name: Schema.String,
  parent: Schema.NullOr(Schema.String),
  /** Path of the folder relative to `.octodo/`, e.g. `l01-garden/l00-seeds`. */
  folder: Schema.String,
});
export type List = typeof List.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  /** The list the task belongs to, or null when its status folder sits directly in `.octodo/`. */
  list: Schema.NullOr(Schema.String),
  priority: Priority,
  tags: Schema.Array(Schema.String),
  due: Schema.NullOr(Schema.String),
  created: Schema.NullOr(Schema.String),
  updated: Schema.NullOr(Schema.String),
  order: Schema.String,
  body: Schema.String,
  /** Path of the file relative to the workspace root. */
  path: Schema.String,
  /** Frontmatter keys the app does not manage, passed through untouched. */
  extra: Schema.Record(Schema.String, Schema.Unknown),
});
export type Task = typeof Task.Type;

export const Diagnostic = Schema.Struct({
  path: Schema.String,
  message: Schema.String,
});
export type Diagnostic = typeof Diagnostic.Type;

export const WorkspaceInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key: Schema.String,
  root: Schema.String,
});
export type WorkspaceInfo = typeof WorkspaceInfo.Type;

export const WorkspaceSnapshot = Schema.Struct({
  workspace: WorkspaceInfo,
  statuses: Schema.Array(StatusDefinition),
  lists: Schema.Array(List),
  tasks: Schema.Array(Task),
  diagnostics: Schema.Array(Diagnostic),
});
export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type;

export const CreateTaskInput = Schema.Struct({
  title: Schema.NonEmptyString,
  status: Schema.optionalKey(Schema.String),
  list: Schema.optionalKey(Schema.NullOr(Schema.String)),
  priority: Schema.optionalKey(Priority),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  due: Schema.optionalKey(Schema.NullOr(Schema.String)),
  body: Schema.optionalKey(Schema.String),
});
export type CreateTaskInput = typeof CreateTaskInput.Type;

export const UpdateTaskInput = Schema.Struct({
  title: Schema.optionalKey(Schema.NonEmptyString),
  priority: Schema.optionalKey(Priority),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  due: Schema.optionalKey(Schema.NullOr(Schema.String)),
  body: Schema.optionalKey(Schema.String),
});
export type UpdateTaskInput = typeof UpdateTaskInput.Type;

/**
 * Moves a task to another status and/or list, optionally placing it between two neighbours.
 * `before` and `after` are task ids in the destination; omitting both puts it last.
 */
export const MoveTaskInput = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  list: Schema.optionalKey(Schema.NullOr(Schema.String)),
  before: Schema.optionalKey(Schema.String),
  after: Schema.optionalKey(Schema.String),
});
export type MoveTaskInput = typeof MoveTaskInput.Type;

/** A folder and the folders directly inside it, for picking a workspace folder remotely. */
export const FolderListing = Schema.Struct({
  path: Schema.String,
  /** The folder above, or null at the filesystem root. */
  parent: Schema.NullOr(Schema.String),
  /** Whether this folder already has a `.octodo/` workspace. */
  workspace: Schema.Boolean,
  folders: Schema.Array(
    Schema.Struct({ name: Schema.String, path: Schema.String, workspace: Schema.Boolean }),
  ),
});
export type FolderListing = typeof FolderListing.Type;

export const CreateListInput = Schema.Struct({
  name: Schema.NonEmptyString,
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CreateListInput = typeof CreateListInput.Type;

/**
 * Moves a list under another parent (null for the top level) and/or places it between two
 * siblings. `before` and `after` are list ids among the destination's children; omitting both
 * puts it last. Moving renames folders, so a list moved to another parent gets a new id.
 */
export const MoveListInput = Schema.Struct({
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  before: Schema.optionalKey(Schema.String),
  after: Schema.optionalKey(Schema.String),
});
export type MoveListInput = typeof MoveListInput.Type;

/**
 * The new order of every status, by id. Categories keep their fixed order whatever is sent, so
 * only the order within a category takes effect.
 */
export const ReorderStatusesInput = Schema.Struct({
  order: Schema.Array(Schema.String),
});
export type ReorderStatusesInput = typeof ReorderStatusesInput.Type;

export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  { workspace: Schema.String },
) {
  override get message(): string {
    return `No workspace found for ${this.workspace}`;
  }
}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {
  override get message(): string {
    return `No task with id ${this.id}`;
  }
}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
