import { Schema } from "effect";

export const Priority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type Priority = typeof Priority.Type;

/**
 * What a status means, independent of its name. Views use it to decide what counts as open,
 * finished or hidden; the folder name only says which bucket a task is in.
 */
export const StatusCategory = Schema.Literals([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "archived",
]);
export type StatusCategory = typeof StatusCategory.Type;

export const StatusDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: StatusCategory,
});
export type StatusDefinition = typeof StatusDefinition.Type;

/** `.tasks/config.json`. Unknown keys are kept when the app rewrites it. */
export const WorkspaceConfig = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  statuses: Schema.optionalKey(Schema.Array(StatusDefinition)),
  /** Folder prefixes that mark a list, mapped to the label shown for that kind of list. */
  listKinds: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type WorkspaceConfig = typeof WorkspaceConfig.Type;

export const DEFAULT_STATUSES: ReadonlyArray<StatusDefinition> = [
  { id: "backlog", name: "Backlog", category: "backlog" },
  { id: "todo", name: "Todo", category: "unstarted" },
  { id: "in-progress", name: "In Progress", category: "started" },
  { id: "done", name: "Done", category: "completed" },
  { id: "archived", name: "Archived", category: "archived" },
];

export const DEFAULT_LIST_KINDS: Readonly<Record<string, string>> = {
  c: "Category",
  p: "Project",
};

export const List = Schema.Struct({
  /** Path of the list folder relative to `.tasks/`, e.g. `c-groceries` or `p-garden/c-seeds`. */
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  parent: Schema.NullOr(Schema.String),
});
export type List = typeof List.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  /** The list the task belongs to, or null when its status folder sits directly in `.tasks/`. */
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

export const CreateListInput = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.String,
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CreateListInput = typeof CreateListInput.Type;

export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  { workspace: Schema.String },
) {}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
