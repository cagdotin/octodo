import {
  DueDate,
  Priority,
  Tags,
  type AttachmentContent,
  type CreateTaskInput,
  type Entry,
  type InvalidRequest,
  type StorageError,
  type WorkspaceBusy,
  type Task,
  type TaskNotFound,
} from "@octodo/contract";
import { catalog, type FileSuccess, type Operation } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { LINK_KINDS } from "@octodo/contract/rules";
import { Schema, type Effect } from "effect";
import { ENTRY_KEYS, type EntryFile } from "../entries/entry-file.ts";
import { TASKS_SECTION } from "../layout.ts";
import { MARKERS } from "../storage/tree.ts";
import { isHidden } from "../storage/bookkeeping.ts";
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

/**
 * A task of a plugin's kind, or an entry of its section, as its reader gets it: with what every
 * task and entry has, its keys and its files.
 */
export interface KindInput {
  readonly entry: EntryFile;
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

/** What a new entry of a plugin's section starts with besides its plugin's keys. */
export interface NewEntry {
  readonly title: string;
  readonly body?: string | undefined;
}

/** The workspace a plugin's handler gets: the plain task's, and writes of its own kind or section. */
export interface PluginWorkspace extends Workspace {
  /** Creates an entry in the plugin's section with these keys, last in its order. */
  readonly createInSection: (
    input: NewEntry,
    keys: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<Entry, InvalidRequest | StorageError | WorkspaceBusy>;
  /** Creates a task of the plugin's kind with these keys. */
  readonly createOfKind: (
    input: CreateTaskInput,
    keys: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<Task, InvalidRequest | StorageError | WorkspaceBusy>;
  /** Changes the plugin's keys and files of a task of its kind, refusing a task of another kind. */
  readonly editOfKind: (
    taskId: string,
    change: KindChange,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError | WorkspaceBusy>;
  /** The text of each of the plugin's files a task of its kind has, refusing a task of another kind. */
  readonly filesOfKind: (
    taskId: string,
  ) => Effect.Effect<
    ReadonlyMap<string, string>,
    TaskNotFound | InvalidRequest | StorageError | WorkspaceBusy
  >;
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

/** A plugin's `engine` half: its shared half, the reader of its tasks or entries, its handlers. */
export interface Plugin {
  readonly shared: PluginShared;
  /** Reads a task of its kind, or an entry of its section, into its fields and its problems. */
  readonly read: (input: KindInput) => KindRead;
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

const plain = (name: string) => !name.includes("/") && !name.includes("\\") && !isHidden(name);

/**
 * Throws on a set of plugins that cannot all be installed: two with one id, a key or an operation
 * name that two claim (the plain task included), a key every entry has, a marker that is not a
 * plain markdown name or that another section or the tasks section has, a file a folder cannot
 * hold as plugin data, an operation that does not run in a workspace, or a handler missing. Keys
 * are claimed per section. Files are not claimed: a plugin's file is its data only in its own
 * tasks or entries, so two plugins may own one name.
 */
export const checkPlugins = (plugins: ReadonlyArray<Plugin>): void => {
  const claims = new Map<string, string>();
  const claim = (what: string, owner: string) => {
    const other = claims.get(what);
    if (other !== undefined)
      throw new Error(`The ${owner} plugin claims ${what}, which ${other} already has`);
    claims.set(what, owner);
  };
  claim(`the folder ${TASKS_SECTION}`, plainTask.id);
  for (const marker of MARKERS) claim(`the marker ${marker}`, plainTask.id);
  for (const { id, keys, operations, section } of [
    plainTask as PluginShared,
    ...plugins.map((plugin) => plugin.shared),
  ]) {
    claim(`the kind ${id}`, id);
    const among = section === undefined ? "" : ` of ${id} entries`;
    if (section !== undefined) {
      if (!plain(section.marker) || !section.marker.endsWith(".md"))
        throw new Error(`The ${id} plugin's marker ${section.marker} is not a markdown file name`);
      claim(`the folder ${id}`, id);
      claim(`the marker ${section.marker.toLowerCase()}`, id);
      for (const key of ENTRY_KEYS) claim(`the key ${key}${among}`, "every entry");
    }
    for (const key of Object.keys(keys.fields)) claim(`the key ${key}${among}`, id);
    for (const name of Object.keys(operations)) claim(`the operation ${name}`, id);
  }
  for (const { shared, handlers } of plugins) {
    for (const file of shared.files) {
      if (!plain(file) || file.toLowerCase().endsWith(".md"))
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
