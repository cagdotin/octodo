import { Schema, SchemaAST, SchemaTransformation } from "effect";
import { MAX_ATTACHMENT_BYTES, STATUS_CATEGORIES, WORKSPACE_KEY } from "./rules.ts";

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
  /** Whether the task can start now: in no closed category, and not blocked. Never stored. */
  ready: Schema.Boolean,
  /** The task ids the body mentions as `[[HM-3]]`, in order, each once. */
  mentions: Schema.Array(Schema.String),
  /** The tasks whose body mentions this one. Never stored. */
  mentionedIn: Schema.Array(Schema.String),
});
export type Task = typeof Task.Type;

/** What `list_tasks` gives for each task: no body, no frontmatter beyond the attributes. */
export const TaskSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  list: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(Schema.String),
  priority: Priority,
  tags: Schema.Array(Schema.String),
  due: Schema.NullOr(Schema.String),
  blocked: Schema.Boolean,
  ready: Schema.Boolean,
});
export type TaskSummary = typeof TaskSummary.Type;

/** Another task named by a link, with a null title and status when no task has its id. */
export const TaskRef = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
});
export type TaskRef = typeof TaskRef.Type;

/** A file in a task folder that is not `task.md` or a subtask. `path` is relative to the folder. */
export const Attachment = Schema.Struct({
  path: Schema.String,
  /** In bytes. */
  size: Schema.Int,
  mediaType: Schema.String,
});
export type Attachment = typeof Attachment.Type;

/** An attachment and where it is on disk. */
export interface AttachmentFile extends Attachment {
  /** The absolute path of the file. */
  readonly file: string;
}

/** An attachment with its bytes, as `read_attachment` gives it. */
export interface AttachmentContent extends AttachmentFile {
  readonly bytes: Uint8Array;
}

/** A task with the tasks it links to as id, title and status, its direct subtasks and its files. */
export const TaskDetail = Schema.Struct({
  ...Task.fields,
  blockedBy: Schema.Array(TaskRef),
  blocks: Schema.Array(TaskRef),
  mentions: Schema.Array(TaskRef),
  mentionedIn: Schema.Array(TaskRef),
  subtasks: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String, status: Schema.String }),
  ),
  attachments: Schema.Array(Attachment),
});
export type TaskDetail = typeof TaskDetail.Type;

/** Every problem a file under `.octodo/` can have; the engine's `PROBLEMS` table says what each means. */
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

/** What is wrong with a file, before the reader says where. */
export interface Problem {
  readonly kind: DiagnosticKind;
  readonly field: string | null;
  readonly detail: string;
  /** Null when the kind's fix does not apply to this case. */
  readonly fix?: FixAction | null;
}

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

/** What `get_workspace` tells an agent first: the statuses and lists with their task counts. */
export const WorkspaceOverview = Schema.Struct({
  workspace: WorkspaceInfo,
  statuses: Schema.Array(Schema.Struct({ ...StatusDefinition.fields, count: Schema.Number })),
  lists: Schema.Array(Schema.Struct({ ...List.fields, count: Schema.Number })),
  diagnostics: Schema.Array(Diagnostic),
});
export type WorkspaceOverview = typeof WorkspaceOverview.Type;

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

/** What the change feed sends after files in an open workspace change, whoever changed them. */
export const WorkspaceChange = Schema.Struct({ workspace: Schema.String });
export type WorkspaceChange = typeof WorkspaceChange.Type;

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
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No workspace found for ${this.workspace}`;
  }
}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()(
  "TaskNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No task with id ${this.id}`;
  }
}

const megabytes = (bytes: number) => Math.ceil(bytes / 1024 / 1024);

/** No file the engine lists as an attachment of `task` is at `path`. */
export class AttachmentNotFound extends Schema.TaggedError<AttachmentNotFound>()(
  "AttachmentNotFound",
  { task: Schema.String, path: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Task ${this.task} has no attachment ${this.path}`;
  }
}

export class AttachmentTooLarge extends Schema.TaggedError<AttachmentTooLarge>()(
  "AttachmentTooLarge",
  { path: Schema.String, size: Schema.Number },
  { httpApiStatus: 413 },
) {
  override get message(): string {
    return `${this.path} is ${megabytes(this.size)} MB; attachments are limited to ${megabytes(MAX_ATTACHMENT_BYTES)} MB`;
  }
}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  { message: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {}

interface TaggedErrorClass extends Schema.Top {
  readonly fields: Schema.Struct.Fields;
  new (fields: never): { readonly message: string };
}

/** A tagged error on the wire: its encoded fields and its message. */
export type WireError<E extends Schema.Top> = Schema.Codec<
  E["Type"],
  E["Encoded"] & { readonly message: string }
>;

const wireErrors = new WeakMap<Schema.Top, Schema.Top>();

/**
 * A tagged error as clients receive it: its tag, every field and its message, which a getter
 * computes and a plain encode would drop (decision 0006). It keeps the error's HTTP status.
 */
export const wireError = <E extends Schema.Top>(error: E): WireError<E> => {
  const known = wireErrors.get(error);
  if (known !== undefined) return known as WireError<E>;
  const { fields } = error as unknown as TaggedErrorClass;
  const encoded = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, Schema.toEncoded(field)]),
  );
  const ownMessage = "message" in fields;
  const codec = Schema.Struct({ ...encoded, message: Schema.String })
    .pipe(
      Schema.decodeTo(
        Schema.toCodecJson(error),
        SchemaTransformation.transform<object, { readonly message: string }>({
          decode: ({ message, ...rest }) => (ownMessage ? { ...rest, message } : rest),
          encode: (rest) => {
            const { _tag, ...values } = rest as { readonly _tag: string };
            const instance = new (error as unknown as TaggedErrorClass)(values as never);
            return { ...rest, message: instance.message };
          },
        }) as never,
      ),
    )
    .annotate({ httpApiStatus: SchemaAST.resolve(error.ast)?.["httpApiStatus"] as number });
  wireErrors.set(error, codec);
  return codec as unknown as WireError<E>;
};

/** The members of an error schema, a tagged error or a union of them, each as `wireError` gives it. */
export const wireErrorsOf = (error: Schema.Top): Array<Schema.Top> =>
  "members" in error
    ? (error.members as ReadonlyArray<Schema.Top>).map((member) => wireError(member))
    : [wireError(error)];
