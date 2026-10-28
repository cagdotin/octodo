import { Duration, Effect, Path, Scope, Stream } from "effect";
import { isWorkspaceKey } from "./layout.ts";
import {
  DEFAULT_STATUSES,
  InvalidRequest,
  StorageError,
  TaskNotFound,
  type CreateListInput,
  type CreateTaskInput,
  type FixRequest,
  type FixResult,
  type List,
  type MoveListInput,
  type MoveTaskInput,
  type ReorderStatusesInput,
  type StatusDefinition,
  type Task,
  type UpdateTaskInput,
  type WorkspaceConfig,
  type WorkspaceSnapshot,
} from "@octodo/contract";
import { deriveKey, humanize } from "@octodo/contract/rules";
import { fixAll, fixDiagnostic } from "./health/operations.ts";
import { createList, moveList } from "./lists/operations.ts";
import { makeState, storageError } from "./state.ts";
import { reorderStatuses } from "./statuses/operations.ts";
import { hasConfig } from "./storage/config.ts";
import { createWorkspace, type Platform } from "./storage/storage.ts";
import { attachmentPath, writeAttachment } from "./tasks/attachments.ts";
import { createTask, deleteTask, getTask, moveTask, updateTask } from "./tasks/operations.ts";

/** One workspace on disk: a folder with a `.octodo/` directory. The files are the source of truth. */
export interface Workspace {
  readonly id: string;
  readonly root: string;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, StorageError>;
  readonly getTask: (id: string) => Effect.Effect<Task, TaskNotFound | StorageError>;
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<Task, InvalidRequest | StorageError>;
  /**
   * Refuses links to the task itself and to unknown tasks, except unknown ones its field already
   * lists, so a dangling blocker never stops an edit of the others.
   */
  readonly updateTask: (
    id: string,
    input: UpdateTaskInput,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError>;
  readonly moveTask: (
    id: string,
    input: MoveTaskInput,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError>;
  /**
   * Removes the task's folder: its subtasks and attachments go with it. Other tasks' links to any
   * of them are removed first, so a rerun after a crash finishes the cleanup.
   */
  readonly deleteTask: (id: string) => Effect.Effect<void, TaskNotFound | StorageError>;
  readonly createList: (
    input: CreateListInput,
  ) => Effect.Effect<List, InvalidRequest | StorageError>;
  readonly moveList: (
    id: string,
    input: MoveListInput,
  ) => Effect.Effect<List, InvalidRequest | StorageError>;
  readonly reorderStatuses: (
    input: ReorderStatusesInput,
  ) => Effect.Effect<ReadonlyArray<StatusDefinition>, InvalidRequest | StorageError>;
  /**
   * The absolute path of a file in a task's folder, from a path relative to it. Refuses anything
   * outside the folder, hidden names, paths into a subtask, and `task.md` or `list.md` at any
   * depth and in any case.
   */
  readonly attachmentPath: (
    taskId: string,
    relativePath: string,
  ) => Effect.Effect<string, TaskNotFound | InvalidRequest | StorageError>;
  /**
   * Saves a file in a task's folder, creating the folders on the way (`images/`), and returns the
   * path relative to the task folder it got: a taken name gets `-2`, `-3`, ... before its extension.
   */
  readonly writeAttachment: (
    taskId: string,
    relativePath: string,
    bytes: Uint8Array,
  ) => Effect.Effect<string, TaskNotFound | InvalidRequest | StorageError>;
  /**
   * Applies fix `action` to the problem `kind` at `path` if a fresh read still offers that fix
   * there. Repeating a request, or sending one the files no longer match, changes nothing.
   */
  readonly fixDiagnostic: (request: FixRequest) => Effect.Effect<FixResult, StorageError>;
  /**
   * Applies every fix that cannot lose what a person meant, reading the files again after each,
   * until none is left to try.
   */
  readonly fixAll: Effect.Effect<FixResult, StorageError>;
  /** Emits after files under `.octodo/` change, whoever changed them. Empty unless watching. */
  readonly changes: Stream.Stream<void>;
}

/** Creates `.octodo/` with a config. Leaves an existing one alone. */
export const initWorkspace = Effect.fnUntraced(function* (
  root: string,
  options: { readonly name?: string | undefined; readonly key?: string | undefined } = {},
) {
  const path = yield* Path.Path;
  if (yield* storageError("Could not read the workspace")(hasConfig(root))) return;
  if (options.key !== undefined && !isWorkspaceKey(options.key))
    return yield* new InvalidRequest({
      message: `The key ${JSON.stringify(options.key)} must be letters and digits, starting with a letter, such as HM`,
    });
  const name = options.name ?? humanize(path.basename(root));
  const config: WorkspaceConfig = {
    name,
    key: options.key ?? deriveKey(name),
    statuses: DEFAULT_STATUSES,
  };
  yield* createWorkspace(root, config).pipe(storageError("Could not create the workspace"));
});

export const makeWorkspace = Effect.fnUntraced(function* (
  id: string,
  root: string,
  options: {
    readonly watch?: boolean;
    /** How long a write waits for another process to release the owner lock. */
    readonly lockWait?: Duration.Input;
  } = {},
) {
  const state = yield* makeState(id, root, options);
  return {
    id,
    root,
    snapshot: state.read(Effect.map(state.scan, (scan) => scan.snapshot)),
    getTask: (taskId) => getTask(state, taskId),
    createTask: (input) => createTask(state, input),
    updateTask: (taskId, input) => updateTask(state, taskId, input),
    moveTask: (taskId, input) => moveTask(state, taskId, input),
    deleteTask: (taskId) => deleteTask(state, taskId),
    createList: (input) => createList(state, input),
    moveList: (listId, input) => moveList(state, listId, input),
    reorderStatuses: (input) => reorderStatuses(state, input),
    attachmentPath: (taskId, relativePath) => attachmentPath(state, taskId, relativePath),
    writeAttachment: (taskId, relativePath, bytes) =>
      writeAttachment(state, taskId, relativePath, bytes),
    fixDiagnostic: (request) => fixDiagnostic(state, request),
    fixAll: fixAll(state),
    changes: state.storage.changes,
  } satisfies Workspace;
});

export type MakeWorkspaceRequirements = Platform | Scope.Scope;
