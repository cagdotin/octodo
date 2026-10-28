import { Duration, Effect, Path, Scope, Stream } from "effect";
import { isWorkspaceKey } from "./layout.ts";
import {
  InvalidRequest,
  type Attachment,
  type AttachmentContent,
  type AttachmentFile,
  type AttachmentNotFound,
  type AttachmentTooLarge,
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
import { DEFAULT_PRESET, PRESETS, type PresetId } from "@octodo/contract/presets";
import { deriveKey, humanize } from "@octodo/contract/rules";
import { fixAll, fixDiagnostic } from "./health/operations.ts";
import { createList, moveList } from "./lists/operations.ts";
import { makeState, storageError } from "./state.ts";
import { setPluginEnabled } from "./settings/plugins.ts";
import { reorderStatuses } from "./statuses/operations.ts";
import { hasConfig } from "./storage/config.ts";
import { createWorkspace, type Platform } from "./storage/storage.ts";
import {
  getAttachment,
  listAttachments,
  readAttachment,
  writeAttachment,
} from "./tasks/attachments.ts";
import type { KindChange, Plugin } from "./plugins/plugin.ts";
import {
  createTask,
  deleteTask,
  editKind,
  getTask,
  kindFiles,
  moveTask,
  updateTask,
} from "./tasks/operations.ts";
import type { NewKind } from "./tasks/task-file.ts";

/** One workspace on disk: a folder with a `.octodo/` directory. The files are the source of truth. */
export interface Workspace {
  readonly id: string;
  readonly root: string;
  /** The plugins octodo has, whether this workspace enables them or not. */
  readonly plugins: ReadonlyArray<Plugin>;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, StorageError>;
  readonly getTask: (id: string) => Effect.Effect<Task, TaskNotFound | StorageError>;
  /** `kind` makes it a task of an enabled plugin's kind, with that plugin's keys. */
  readonly createTask: (
    input: CreateTaskInput,
    kind?: NewKind,
  ) => Effect.Effect<Task, InvalidRequest | StorageError>;
  /**
   * Writes the plugin `plugin`'s keys and files of a task of its kind, refusing any other task,
   * key or file. Its plugin's handlers reach it as `editOfKind`.
   */
  readonly editKind: (
    plugin: string,
    taskId: string,
    change: KindChange,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError>;
  /** The text of the plugin `plugin`'s files in a task of its kind, refusing any other task. */
  readonly kindFiles: (
    plugin: string,
    taskId: string,
  ) => Effect.Effect<ReadonlyMap<string, string>, TaskNotFound | InvalidRequest | StorageError>;
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
   * Adds the plugin to config.json's `plugins` or takes it out, and gives the plugins the
   * workspace enables then. Enabling refuses a plugin octodo does not have.
   */
  readonly setPlugin: (
    plugin: string,
    enabled: boolean,
  ) => Effect.Effect<ReadonlyArray<string>, InvalidRequest | StorageError>;
  /** The files in a task's folder that are its attachments, with their sizes and media types. */
  readonly attachments: (
    taskId: string,
  ) => Effect.Effect<ReadonlyArray<Attachment>, TaskNotFound | StorageError>;
  /**
   * One of a task's attachments and where it is, without reading it. Refuses anything outside the
   * folder, hidden names, paths into a subtask, `task.md` or `list.md` at any depth and in any case,
   * and any file the folder does not list as an attachment.
   */
  readonly attachment: (
    taskId: string,
    relativePath: string,
  ) => Effect.Effect<
    AttachmentFile,
    TaskNotFound | InvalidRequest | AttachmentNotFound | StorageError
  >;
  /** The bytes of one of a task's attachments, as `attachment` finds it, up to the upload limit. */
  readonly readAttachment: (
    taskId: string,
    relativePath: string,
  ) => Effect.Effect<
    AttachmentContent,
    TaskNotFound | InvalidRequest | AttachmentNotFound | AttachmentTooLarge | StorageError
  >;
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

export interface WorkspaceOptions {
  readonly name?: string | undefined;
  readonly key?: string | undefined;
  /** The statuses and plugins it starts with; the default preset when omitted. */
  readonly preset?: PresetId | undefined;
}

/** Creates `.octodo/` with a config copied from a preset. Leaves an existing one alone. */
export const initWorkspace = Effect.fnUntraced(function* (
  root: string,
  options: WorkspaceOptions = {},
) {
  const path = yield* Path.Path;
  if (yield* storageError("Could not read the workspace")(hasConfig(root))) return;
  if (options.key !== undefined && !isWorkspaceKey(options.key))
    return yield* new InvalidRequest({
      message: `The key ${JSON.stringify(options.key)} must be letters and digits, starting with a letter, such as HM`,
    });
  const name = options.name ?? humanize(path.basename(root));
  const preset = PRESETS[options.preset ?? DEFAULT_PRESET];
  const config: WorkspaceConfig = {
    name,
    key: options.key ?? deriveKey(name),
    statuses: preset.statuses,
    ...(preset.plugins.length === 0 ? {} : { plugins: preset.plugins }),
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
    /** The plugins octodo has; the workspace's config.json picks which of them apply. */
    readonly plugins?: ReadonlyArray<Plugin>;
  } = {},
) {
  const state = yield* makeState(id, root, options);
  return {
    id,
    root,
    plugins: state.plugins,
    snapshot: state.read(Effect.map(state.scan, (scan) => scan.snapshot)),
    getTask: (taskId) => getTask(state, taskId),
    createTask: (input, kind?: NewKind) => createTask(state, input, kind),
    editKind: (plugin, taskId, change) => editKind(state, plugin, taskId, change),
    kindFiles: (plugin, taskId) => kindFiles(state, plugin, taskId),
    updateTask: (taskId, input) => updateTask(state, taskId, input),
    moveTask: (taskId, input) => moveTask(state, taskId, input),
    deleteTask: (taskId) => deleteTask(state, taskId),
    createList: (input) => createList(state, input),
    moveList: (listId, input) => moveList(state, listId, input),
    reorderStatuses: (input) => reorderStatuses(state, input),
    setPlugin: (plugin, enabled) => setPluginEnabled(state, plugin, enabled),
    attachment: (taskId, relativePath) => getAttachment(state, taskId, relativePath),
    attachments: (taskId) => listAttachments(state, taskId),
    readAttachment: (taskId, relativePath) => readAttachment(state, taskId, relativePath),
    writeAttachment: (taskId, relativePath, bytes) =>
      writeAttachment(state, taskId, relativePath, bytes),
    fixDiagnostic: (request) => fixDiagnostic(state, request),
    fixAll: fixAll(state),
    changes: state.storage.changes,
  } satisfies Workspace;
});

export type MakeWorkspaceRequirements = Platform | Scope.Scope;
