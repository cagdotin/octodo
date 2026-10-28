import {
  DueDate,
  Priority,
  Tags,
  type AttachmentContent,
  type CreateTaskInput,
  type InvalidRequest,
  type StorageError,
  type Task,
  type TaskNotFound,
} from "@octodo/contract";
import { catalog, type FileSuccess, type Operation } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { LINK_KINDS } from "@octodo/contract/rules";
import { Schema, type Effect } from "effect";
import { MARKERS } from "../storage/tree.ts";
import { isHidden } from "../storage/bookkeeping.ts";
import type { TaskFile } from "../tasks/task-file.ts";
import type { Workspace } from "../workspace.ts";

/** The plain task: the kind of a task without `type`, and the frontmatter keys every task has. */
export const plainTask = {
  id: "task",
  name: "Tasks",
  description: "The plain task every workspace has.",
  keys: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    /** Names the task's kind: a plugin's id. */
    type: Schema.String,
    status: Schema.String,
    priority: Priority,
    tags: Tags,
    due: DueDate,
    created: Schema.String,
    order: Schema.String,
    /** No longer written, but older files have it: `updated` comes from the file's mtime. */
    updated: Schema.String,
    ...Object.fromEntries(LINK_KINDS.map((kind) => [kind.field, Schema.Array(Schema.String)])),
  }),
  files: [],
  fields: Schema.Struct({}),
  operations: catalog,
  problems: {},
} satisfies PluginShared;

/** A task of a plugin's kind as its reader gets it: read as a plain task, with its keys and files. */
export interface KindInput {
  readonly task: TaskFile;
  /** The values of the plugin's keys the frontmatter has, not yet decoded. */
  readonly keys: Readonly<Record<string, unknown>>;
  /** The text of each of the plugin's files the task folder has, by name. */
  readonly files: ReadonlyMap<string, string>;
}

/** A problem a plugin's reader found, reported as the diagnostic `<plugin>/<problem>`. */
export interface KindProblem<Name extends string = string> {
  readonly problem: Name;
  readonly detail: string;
  /** The key at fault. */
  readonly field?: string;
  /** The plugin's file at fault, which the diagnostic then points at instead of `task.md`. */
  readonly file?: string;
}

export interface KindRead<
  Fields = Readonly<Record<string, unknown>>,
  Name extends string = string,
> {
  readonly fields: Fields;
  readonly problems: ReadonlyArray<KindProblem<Name>>;
}

/** What one write of a plugin changes in a task of its kind. */
export interface KindChange {
  /** Its keys to set; `undefined` removes one. */
  readonly keys?: Readonly<Record<string, unknown>>;
  /** Each of its files' new text, from the text it has now (null for a file it does not have). */
  readonly files?: Readonly<Record<string, (text: string | null) => string>>;
}

/** The workspace a plugin's handler gets: the plain task's, and writes of its own kind. */
export interface PluginWorkspace extends Workspace {
  /** Creates a task of the plugin's kind with these keys. */
  readonly createOfKind: (
    input: CreateTaskInput,
    keys: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<Task, InvalidRequest | StorageError>;
  /** Changes the plugin's keys and files of a task of its kind, refusing a task of another kind. */
  readonly editOfKind: (
    taskId: string,
    change: KindChange,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError>;
  /** The text of each of the plugin's files a task of its kind has, refusing a task of another kind. */
  readonly filesOfKind: (
    taskId: string,
  ) => Effect.Effect<ReadonlyMap<string, string>, TaskNotFound | InvalidRequest | StorageError>;
}

type Success<O extends Operation> = O["success"] extends FileSuccess
  ? AttachmentContent
  : O["success"] extends Schema.Top
    ? O["success"]["Type"]
    : never;

export type PluginHandler<O extends Operation = Operation> = (
  workspace: PluginWorkspace,
  input: Omit<O["input"]["Type"], "workspace">,
) => Effect.Effect<Success<O>, O["error"]["Type"]>;

/** A plugin's `engine` half: its shared half, the reader of its tasks, and its handlers. */
export interface Plugin {
  readonly shared: PluginShared;
  /** Reads a task of its kind into its computed fields and the problems it has. */
  readonly read: (task: KindInput) => KindRead;
  readonly handlers: Readonly<Record<string, PluginHandler>>;
  /**
   * What completing a task of its kind writes instead of closing it: a move into a completed
   * status writes this change and puts the task in the first unstarted status. `at` is the
   * minute it happened, in UTC.
   */
  readonly complete?: ((at: string) => KindChange) | undefined;
}

/** A plugin, typed from its shared half: a handler per operation, problems it declares, its fields. */
export const definePlugin = <S extends PluginShared>(
  shared: S,
  engine: {
    readonly read: (
      task: KindInput,
    ) => KindRead<S["fields"]["Type"], Extract<keyof S["problems"], string>>;
    readonly handlers: { readonly [K in keyof S["operations"]]: PluginHandler<S["operations"][K]> };
    readonly complete?: (at: string) => KindChange;
  },
): Plugin => {
  const encode = Schema.encodeSync(shared.fields as unknown as Schema.Codec<unknown, unknown>);
  return {
    shared,
    read: (task) => {
      const { fields, problems } = engine.read(task);
      return { fields: encode(fields) as Record<string, unknown>, problems };
    },
    handlers: engine.handlers as unknown as Plugin["handlers"],
    complete: engine.complete,
  };
};

const reserved = (name: string) =>
  name.includes("/") || name.includes("\\") || isHidden(name) || name.endsWith(".md");

/**
 * Throws on a set of plugins that cannot all be installed: two with one id, a key or an operation
 * name that two claim (the plain task included), a file a task folder cannot hold as plugin data,
 * an operation that does not run in a workspace, or a handler missing. Files are not claimed: a
 * plugin's file is its data only in tasks of its kind, so two kinds may own one name.
 */
export const checkPlugins = (plugins: ReadonlyArray<Plugin>): void => {
  const claims = new Map<string, string>();
  const claim = (what: string, owner: string) => {
    const other = claims.get(what);
    if (other !== undefined)
      throw new Error(`The ${owner} plugin claims ${what}, which ${other} already has`);
    claims.set(what, owner);
  };
  for (const { id, keys, operations } of [plainTask, ...plugins.map((plugin) => plugin.shared)]) {
    claim(`the kind ${id}`, id);
    for (const key of Object.keys(keys.fields)) claim(`the key ${key}`, id);
    for (const name of Object.keys(operations)) claim(`the operation ${name}`, id);
  }
  for (const { shared, handlers } of plugins) {
    for (const file of shared.files) {
      if (reserved(file) || MARKERS.includes(file.toLowerCase()))
        throw new Error(`The ${shared.id} plugin cannot own ${file}: name a plain file`);
    }
    for (const [name, operation] of Object.entries(shared.operations)) {
      if (!("workspace" in operation.input.fields))
        throw new Error(`The ${shared.id} plugin's ${name} must run in a workspace`);
      if (handlers[name] === undefined)
        throw new Error(`The ${shared.id} plugin has no handler for ${name}`);
    }
  }
};
