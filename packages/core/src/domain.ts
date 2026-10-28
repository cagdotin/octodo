import { Schema } from "effect";
import { STATUS_CATEGORIES, WORKSPACE_KEY } from "./layout.ts";

export const Priority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type Priority = typeof Priority.Type;

const DUE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

const isCalendarDay = (year: number, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A calendar day, `YYYY-MM-DD`, or a time on one, `YYYY-MM-DDTHH:mm[:ss][Z|±hh:mm]`. */
export const DueDate = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value: string) => {
        const match = DUE.exec(value);
        return (
          match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]))
        );
      },
      { message: "Use a date such as 2026-11-01, or a date and time such as 2026-11-01T10:00" },
    ),
  ),
);

export const Tags = Schema.Array(Schema.String);

/** The prefix of a workspace's task ids, as `HM` in `HM-42`. */
export const WorkspaceKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(WORKSPACE_KEY, {
      message: "Use letters and digits, starting with a letter, such as HM",
    }),
  ),
);

/**
 * What a status means, independent of its name. Views use it to decide what counts as open,
 * finished or hidden; `STATUS_CATEGORIES` gives the order.
 */
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
 * within each category is the workflow order.
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
 * A folder with `list.md`. Snapshots give lists depth first, each among its siblings by `order`, so
 * a tree can be built by walking the array once.
 */
export const List = Schema.Struct({
  /** The folder names from `.octodo/` down to the list: `garden/seeds`. */
  id: Schema.String,
  /** From `list.md`, or the humanized folder name when it has none. */
  name: Schema.String,
  parent: Schema.NullOr(Schema.String),
  /** Path of the folder relative to `.octodo/`, e.g. `garden/seeds`. */
  folder: Schema.String,
});
export type List = typeof List.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  /** The nearest list folder above the task; a subtask is in its parent's list. */
  list: Schema.NullOr(Schema.String),
  /** The task whose folder holds this one, or null for a task directly in a list or `.octodo/`. */
  parent: Schema.NullOr(Schema.String),
  priority: Priority,
  tags: Tags,
  due: Schema.NullOr(DueDate),
  created: Schema.NullOr(Schema.String),
  /** When `task.md` last changed on disk. */
  updated: Schema.NullOr(Schema.String),
  order: Schema.String,
  body: Schema.String,
  /** Path of `task.md` relative to the workspace root. */
  path: Schema.String,
  /** Frontmatter keys the app does not manage, passed through untouched. */
  extra: Schema.Record(Schema.String, Schema.Unknown),
  /** The tasks this one waits for, from `blocked_by`. An id may match no task. */
  blockedBy: Schema.Array(Schema.String),
  /** The tasks waiting for this one; computed from their `blocked_by`, never stored. */
  blocks: Schema.Array(Schema.String),
  /** Whether a task in `blockedBy` is still open or matches no task. Never stored. */
  blocked: Schema.Boolean,
  /** The task ids the body mentions as `[[HM-3]]`, in order, each once. */
  mentions: Schema.Array(Schema.String),
  /** The tasks whose body mentions this one. Never stored. */
  mentionedIn: Schema.Array(Schema.String),
});
export type Task = typeof Task.Type;

/** Every problem a file under `.octodo/` can have; `diagnostics.ts` says what each means. */
export const DiagnosticKind = Schema.Literals([
  "invalid-config",
  "invalid-frontmatter",
  "missing-id",
  "malformed-id",
  "duplicate-id",
  "foreign-id",
  "unknown-status",
  "unknown-priority",
  "invalid-due",
  "invalid-tags",
  "broken-link",
  "self-link",
  "malformed-link",
  "loose-markdown",
  "note",
  "conflict-copy",
  "unmarked-folder",
  "both-markers",
  "list-in-task",
  "list-too-deep",
  "unreadable",
  "symlink",
]);
export type DiagnosticKind = typeof DiagnosticKind.Type;

/** A mechanical repair octodo can make for a diagnostic, never on its own: only when asked. */
export const FixAction = Schema.Literals([
  "fresh-id",
  "wrap-as-task",
  "keep-copy",
  "remove-copy",
  "drop-unknown-links",
  "drop-self-link",
  "normalize-links",
  "add-status",
]);
export type FixAction = typeof FixAction.Type;

export const Fix = Schema.Struct({
  action: FixAction,
  label: Schema.String,
  /** Whether fix-all applies it; a fix that guesses what a person meant is applied one at a time. */
  inFixAll: Schema.Boolean,
});
export type Fix = typeof Fix.Type;

/** A problem with one file or folder. `field` names the frontmatter key at fault, if any. */
export const Diagnostic = Schema.Struct({
  path: Schema.String,
  kind: DiagnosticKind,
  field: Schema.NullOr(Schema.String),
  message: Schema.String,
  fix: Schema.NullOr(Fix),
});
export type Diagnostic = typeof Diagnostic.Type;

/**
 * Asks for fix `action` of the problem `kind` at `path`. The workspace reads the files again and
 * applies it only if a fresh read still offers that fix there, so a request made before the files
 * changed cannot run another fix than the one asked for.
 */
export const FixRequest = Schema.Struct({
  path: Schema.String,
  kind: DiagnosticKind,
  action: FixAction,
});
export type FixRequest = typeof FixRequest.Type;

export const FixResult = Schema.Struct({
  fixed: Schema.Array(Diagnostic),
  failed: Schema.Array(Schema.Struct({ diagnostic: Diagnostic, error: Schema.String })),
  /** What is left after fixing, as a fresh read finds it. */
  diagnostics: Schema.Array(Diagnostic),
});
export type FixResult = typeof FixResult.Type;

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

/** `list` and a non-null `parent` are exclusive: a subtask is in its parent's list. */
export const CreateTaskInput = Schema.Struct({
  title: Schema.NonEmptyString,
  status: Schema.optionalKey(Schema.String),
  list: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  priority: Schema.optionalKey(Priority),
  tags: Schema.optionalKey(Tags),
  due: Schema.optionalKey(Schema.NullOr(DueDate)),
  body: Schema.optionalKey(Schema.String),
});
export type CreateTaskInput = typeof CreateTaskInput.Type;

export const UpdateTaskInput = Schema.Struct({
  title: Schema.optionalKey(Schema.NonEmptyString),
  priority: Schema.optionalKey(Priority),
  tags: Schema.optionalKey(Tags),
  due: Schema.optionalKey(Schema.NullOr(DueDate)),
  body: Schema.optionalKey(Schema.String),
  /** Task ids this one waits for, replacing the current ones; empty removes the key. */
  blocked_by: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type UpdateTaskInput = typeof UpdateTaskInput.Type;

/**
 * Moves a task to another status, list or parent task, optionally placing it between two
 * neighbours. `list` and a non-null `parent` are exclusive; `parent: null` lifts a subtask into
 * its list. Order holds among the tasks of one container, whatever their status: `before` and
 * `after` are task ids there. Without either, a task keeps its place when only its status changes
 * and goes last when it changes container.
 */
export const MoveTaskInput = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  list: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
 * puts it last. A list moved to another parent gets a new id.
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
