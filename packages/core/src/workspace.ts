import {
  DateTime,
  Effect,
  FileSystem,
  Option,
  Path,
  PubSub,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import {
  DEFAULT_STATUSES,
  InvalidRequest,
  StorageError,
  TaskNotFound,
  type CreateListInput,
  type CreateTaskInput,
  type List,
  type MoveListInput,
  type MoveTaskInput,
  type ReorderStatusesInput,
  type StatusDefinition,
  type Task,
  type UpdateTaskInput,
  type WorkspaceConfig,
  type WorkspaceSnapshot,
} from "./domain.ts";
import { writeFileAtomic } from "./files.ts";
import {
  CONFIG_FILE,
  LIST_FILE,
  MAX_LIST_DEPTH,
  TASK_FILE,
  TASKS_DIR,
  defaultStatus,
  deriveKey,
  humanize,
  idNumber,
  inTaskSubtree,
  listDepth,
  listMoveError,
  movedListId,
  slugify,
  sortStatuses,
  taskFolderName,
} from "./layout.ts";
import { editTaskFile, newListFile, newTaskFile, patchFrontmatter } from "./markdown.ts";
import { scanWorkspace, type Scan } from "./scan.ts";

/** One workspace on disk: a folder with a `.octodo/` directory. The files are the source of truth. */
export interface Workspace {
  readonly id: string;
  readonly root: string;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, StorageError>;
  readonly getTask: (id: string) => Effect.Effect<Task, TaskNotFound | StorageError>;
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<Task, InvalidRequest | StorageError>;
  readonly updateTask: (
    id: string,
    input: UpdateTaskInput,
  ) => Effect.Effect<Task, TaskNotFound | StorageError>;
  readonly moveTask: (
    id: string,
    input: MoveTaskInput,
  ) => Effect.Effect<Task, TaskNotFound | InvalidRequest | StorageError>;
  /** Removes the task's folder: its subtasks and attachments go with it. */
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
   * outside the folder, `task.md` itself, hidden names and paths into a subtask.
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
  /** Emits after files under `.octodo/` change, whoever changed them. Empty unless watching. */
  readonly changes: Stream.Stream<void>;
}

/** Where a task sits: in a list (or `.octodo/` for null), or under a parent task in that list. */
interface Container {
  readonly list: string | null;
  readonly parent: string | null;
}

const TOP: Container = { list: null, parent: null };

const storage =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, StorageError, R> =>
    Effect.mapError(effect, (cause) => new StorageError({ message, cause }));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const orderBetween = (
  column: ReadonlyArray<{ readonly id: string; readonly order: string }>,
  input: { readonly before?: string | undefined; readonly after?: string | undefined },
) => {
  if (input.before !== undefined) {
    const index = column.findIndex((item) => item.id === input.before);
    if (index !== -1)
      return generateKeyBetween(column[index - 1]?.order ?? null, column[index]!.order);
  }
  if (input.after !== undefined) {
    const index = column.findIndex((item) => item.id === input.after);
    if (index !== -1)
      return generateKeyBetween(column[index]!.order, column[index + 1]?.order ?? null);
  }
  return generateKeyBetween(column.at(-1)?.order ?? null, null);
};

/** Creates `.octodo/` with a config. Leaves an existing one alone. */
export const initWorkspace = Effect.fnUntraced(function* (
  root: string,
  options: { readonly name?: string | undefined; readonly key?: string | undefined } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tasksDir = path.join(root, TASKS_DIR);
  const configPath = path.join(tasksDir, CONFIG_FILE);
  if (yield* storage("Could not read the workspace")(fs.exists(configPath))) return;
  const name = options.name ?? humanize(path.basename(root));
  const config: WorkspaceConfig = {
    name,
    key: options.key ?? deriveKey(name),
    statuses: DEFAULT_STATUSES,
  };
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(tasksDir, { recursive: true });
    yield* writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }).pipe(storage("Could not create the workspace"));
});

export const makeWorkspace = Effect.fnUntraced(function* (
  id: string,
  root: string,
  options: { readonly watch?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tasksDir = path.join(root, TASKS_DIR);
  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make(Option.none<Scan>());
  const changes = yield* PubSub.sliding<void>(16);
  const withPlatform = <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  ): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const writeAtomic = (file: string, content: string | Uint8Array) =>
    withPlatform(writeFileAtomic(file, content));

  const state = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (Option.isSome(cached)) return cached.value;
    const fresh = yield* storage("Could not read the workspace")(
      withPlatform(scanWorkspace(id, root)),
    );
    yield* Ref.set(cache, Option.some(fresh));
    return fresh;
  });
  const current = Effect.map(state, ({ snapshot }) => snapshot);

  const invalidate = Ref.set(cache, Option.none());

  const findTask = (snapshot: WorkspaceSnapshot, taskId: string) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    return task === undefined
      ? Effect.fail(new TaskNotFound({ id: taskId }))
      : Effect.succeed(task);
  };

  const invalid = (message: string) => Effect.fail(new InvalidRequest({ message }));

  const checkStatus = (snapshot: WorkspaceSnapshot, status: string) =>
    snapshot.statuses.some((known) => known.id === status)
      ? Effect.void
      : invalid(`Unknown status "${status}"`);

  /**
   * The container a create or move puts a task in. `parent` wins the list from its task; `list`
   * alone takes the task to the top of that list; neither keeps `from`.
   */
  const destination = (
    snapshot: WorkspaceSnapshot,
    input: { readonly list?: string | null; readonly parent?: string | null },
    from: Container,
  ): Effect.Effect<Container, InvalidRequest> => {
    if (input.parent !== undefined && input.parent !== null) {
      if (input.list !== undefined) return invalid("Give a list or a parent task, not both");
      const parent = snapshot.tasks.find((task) => task.id === input.parent);
      return parent === undefined
        ? invalid(`Unknown parent task "${input.parent}"`)
        : Effect.succeed({ list: parent.list, parent: parent.id });
    }
    const list = input.list === undefined ? from.list : input.list;
    if (list !== null && !snapshot.lists.some((known) => known.id === list))
      return invalid(`Unknown list "${list}"`);
    const keepParent = input.list === undefined && input.parent === undefined;
    return Effect.succeed({ list, parent: keepParent ? from.parent : null });
  };

  const containerDir = ({ dirs }: Scan, { list, parent }: Container) =>
    parent !== null
      ? dirs.tasks.get(parent)!
      : list !== null
        ? dirs.lists.get(list)!.dir
        : tasksDir;

  const column = (
    snapshot: WorkspaceSnapshot,
    status: string,
    { list, parent }: Container,
    except?: string,
  ) =>
    snapshot.tasks.filter(
      (task) =>
        task.status === status &&
        task.list === list &&
        task.parent === parent &&
        task.id !== except,
    );

  /** Gives every item an order key, so a new key can be placed between any two. */
  const ensureOrdered = <A extends { readonly order: string }>(
    items: ReadonlyArray<A>,
    file: (item: A) => string,
  ) =>
    Effect.gen(function* () {
      if (items.every((item) => item.order !== "")) return items;
      const keys = generateNKeysBetween(null, null, items.length);
      const ordered: Array<A> = [];
      for (const [index, item] of items.entries()) {
        const order = keys[index]!;
        const target = file(item);
        yield* writeAtomic(target, patchFrontmatter(yield* fs.readFileString(target), { order }));
        ordered.push({ ...item, order });
      }
      return ordered;
    });

  const orderedColumn = (
    snapshot: WorkspaceSnapshot,
    status: string,
    container: Container,
    except?: string,
  ) =>
    ensureOrdered(column(snapshot, status, container, except), (task) =>
      path.join(root, task.path),
    );

  /** Sibling lists under `parent` with their order keys, which the snapshot leaves out. */
  const orderedLists = ({ snapshot, dirs }: Scan, parent: string | null, except?: string) =>
    ensureOrdered(
      snapshot.lists
        .filter((list) => list.parent === parent && list.id !== except)
        .map((list) => ({ id: list.id, ...dirs.lists.get(list.id)! })),
      (list) => path.join(list.dir, LIST_FILE),
    );

  /** `name`, or `name-2`, `name-3`, ... before the extension, whichever `dir` does not have yet. */
  const freeName = (dir: string, name: string, extension = "") =>
    Effect.gen(function* () {
      const stem = name.slice(0, name.length - extension.length);
      let candidate = name;
      for (let n = 2; yield* fs.exists(path.join(dir, candidate)); n++) {
        candidate = `${stem}-${n}${extension}`;
      }
      return candidate;
    });

  /**
   * Builds a folder with its marker file under a hidden name, then renames it into place, so no
   * reader sees a folder without its `task.md` or `list.md`. Fails if `container` is gone.
   */
  const createFolder = (container: string, name: string, marker: string, content: string) =>
    Effect.gen(function* () {
      const temp = path.join(container, `.new-${crypto.randomUUID()}`);
      yield* fs.makeDirectory(temp);
      yield* Effect.gen(function* () {
        yield* fs.writeFileString(path.join(temp, marker), content);
        yield* fs.rename(temp, path.join(container, name));
      }).pipe(Effect.onError(() => Effect.ignore(fs.remove(temp, { recursive: true }))));
    });

  /** Moves a folder into another existing container, keeping its name when it is free. */
  const moveFolder = (dir: string, container: string) =>
    Effect.gen(function* () {
      if (path.dirname(dir) === container) return;
      const name = yield* freeName(container, path.basename(dir));
      yield* fs.rename(dir, path.join(container, name));
    });

  /** Serialises writes and drops the cache afterwards, whatever happened. */
  const write = <A, E>(effect: Effect.Effect<A, E>) =>
    lock.withPermits(1)(Effect.ensuring(effect, invalidate));

  const reread = (taskId: string) =>
    Effect.flatMap(current, (snapshot) => findTask(snapshot, taskId));

  const createTask = (input: CreateTaskInput) =>
    write(
      Effect.gen(function* () {
        const scan = yield* state;
        const { snapshot } = scan;
        const status = input.status ?? defaultStatus(snapshot.statuses)?.id;
        if (status === undefined) return yield* invalid("The workspace has no statuses");
        yield* checkStatus(snapshot, status);
        const container = yield* destination(snapshot, input, TOP);
        const { key } = snapshot.workspace;
        const taskId = `${key}-${Math.max(0, ...snapshot.tasks.map((task) => idNumber(task.id, key) ?? 0)) + 1}`;
        yield* Effect.gen(function* () {
          const siblings = yield* orderedColumn(snapshot, status, container);
          const content = newTaskFile(input, {
            id: taskId,
            status,
            order: orderBetween(siblings, {}),
            now: yield* nowIso,
          });
          const dir = containerDir(scan, container);
          const name = yield* freeName(dir, taskFolderName(taskId, input.title));
          yield* createFolder(dir, name, TASK_FILE, content);
        }).pipe(storage("Could not write the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const updateTask = (taskId: string, input: UpdateTaskInput) =>
    write(
      Effect.gen(function* () {
        const { snapshot, dirs } = yield* state;
        yield* findTask(snapshot, taskId);
        const dir = dirs.tasks.get(taskId)!;
        yield* Effect.gen(function* () {
          const file = path.join(dir, TASK_FILE);
          yield* writeAtomic(file, editTaskFile(yield* fs.readFileString(file), input));
          if (input.title === undefined) return;
          // A taken name leaves the folder as it is: its name is only for people.
          const renamed = path.join(path.dirname(dir), taskFolderName(taskId, input.title));
          if (renamed !== dir && !(yield* fs.exists(renamed))) yield* fs.rename(dir, renamed);
        }).pipe(storage("Could not write the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const moveTask = (taskId: string, input: MoveTaskInput) =>
    write(
      Effect.gen(function* () {
        const scan = yield* state;
        const { snapshot } = scan;
        const task = yield* findTask(snapshot, taskId);
        const status = input.status ?? task.status;
        yield* checkStatus(snapshot, status);
        const container = yield* destination(snapshot, input, task);
        if (container.parent !== null && inTaskSubtree(snapshot.tasks, container.parent, taskId))
          return yield* invalid("A task cannot move inside itself or its subtasks");
        yield* Effect.gen(function* () {
          const order = orderBetween(
            yield* orderedColumn(snapshot, status, container, taskId),
            input,
          );
          const dir = scan.dirs.tasks.get(taskId)!;
          const file = path.join(dir, TASK_FILE);
          const changes = input.status === undefined ? { order } : { order, status };
          yield* writeAtomic(file, patchFrontmatter(yield* fs.readFileString(file), changes));
          yield* moveFolder(dir, containerDir(scan, container));
        }).pipe(storage("Could not move the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const deleteTask = (taskId: string) =>
    write(
      Effect.gen(function* () {
        const { snapshot, dirs } = yield* state;
        yield* findTask(snapshot, taskId);
        yield* storage("Could not delete the task")(
          fs.remove(dirs.tasks.get(taskId)!, { recursive: true }),
        );
      }),
    );

  const findList = (snapshot: WorkspaceSnapshot, list: string) => {
    const found = snapshot.lists.find((known) => known.id === list);
    return found === undefined ? invalid(`Unknown list "${list}"`) : Effect.succeed(found);
  };

  const rereadList = (list: string) =>
    Effect.flatMap(current, (snapshot) => findList(snapshot, list));

  const createList = (input: CreateListInput) =>
    write(
      Effect.gen(function* () {
        const scan = yield* state;
        const { snapshot } = scan;
        const parent = input.parent ?? null;
        if (parent !== null) yield* findList(snapshot, parent);
        if (listDepth(parent) >= MAX_LIST_DEPTH)
          return yield* invalid(`Lists nest at most ${MAX_LIST_DEPTH} levels deep`);
        const slug = slugify(input.name);
        if (slug.length === 0) return yield* invalid("The list name needs a letter or digit");
        const listId = parent === null ? slug : `${parent}/${slug}`;
        const dir = containerDir(scan, { list: parent, parent: null });
        if (
          snapshot.lists.some((known) => known.id === listId) ||
          (yield* storage("Could not read the workspace")(fs.exists(path.join(dir, slug))))
        )
          return yield* invalid(`There is already a list "${listId}"`);
        yield* Effect.gen(function* () {
          const siblings = yield* orderedLists(scan, parent);
          const content = newListFile({ name: input.name, order: orderBetween(siblings, {}) });
          yield* createFolder(dir, slug, LIST_FILE, content);
        }).pipe(storage("Could not create the list"));
        yield* invalidate;
        return yield* rereadList(listId).pipe(Effect.orDie);
      }),
    );

  const moveList = (listId: string, input: MoveListInput) =>
    write(
      Effect.gen(function* () {
        const scan = yield* state;
        const { snapshot, dirs } = scan;
        const list = yield* findList(snapshot, listId);
        const parent = input.parent === undefined ? list.parent : input.parent;
        if (parent !== null) yield* findList(snapshot, parent);
        const refused = listMoveError(snapshot.lists, listId, parent);
        if (refused !== null) return yield* invalid(refused);
        const dir = dirs.lists.get(listId)!.dir;
        const container = containerDir(scan, { list: parent, parent: null });
        const moved = path.join(container, path.basename(dir));
        if (
          parent !== list.parent &&
          (yield* storage("Could not read the workspace")(fs.exists(moved)))
        )
          return yield* invalid(`There is already a folder ${path.relative(root, moved)}`);
        yield* Effect.gen(function* () {
          const order = orderBetween(yield* orderedLists(scan, parent, listId), input);
          const file = path.join(dir, LIST_FILE);
          yield* writeAtomic(file, patchFrontmatter(yield* fs.readFileString(file), { order }));
          if (parent !== list.parent) yield* fs.rename(dir, moved);
        }).pipe(storage("Could not move the list"));
        yield* invalidate;
        return yield* rereadList(movedListId(listId, parent)).pipe(Effect.orDie);
      }),
    );

  const reorderStatuses = (input: ReorderStatusesInput) =>
    write(
      Effect.gen(function* () {
        const snapshot = yield* current;
        const known = new Map(snapshot.statuses.map((status) => [status.id, status]));
        if (
          input.order.length !== known.size ||
          new Set(input.order).size !== known.size ||
          input.order.some((status) => !known.has(status))
        ) {
          return yield* invalid(
            `The order must list every status once: ${[...known.keys()].join(", ")}`,
          );
        }
        const statuses = sortStatuses(input.order.map((status) => known.get(status)!));
        yield* Effect.gen(function* () {
          const configPath = path.join(tasksDir, CONFIG_FILE);
          const text = yield* fs.readFileString(configPath);
          const raw = yield* Effect.try(() => JSON.parse(text) as Record<string, unknown>);
          yield* writeAtomic(configPath, `${JSON.stringify({ ...raw, statuses }, null, 2)}\n`);
        }).pipe(storage("Could not reorder the statuses"));
        yield* invalidate;
        return (yield* current).statuses;
      }),
    );

  /** The task folder and the path segments of a file inside it, refusing anything else. */
  const attachmentTarget = (taskId: string, relativePath: string) =>
    Effect.gen(function* () {
      const { snapshot, dirs } = yield* state;
      yield* findTask(snapshot, taskId);
      const dir = dirs.tasks.get(taskId)!;
      const segments = relativePath.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
      if (path.isAbsolute(relativePath) || segments.length === 0)
        return yield* invalid("Give a path relative to the task folder");
      if (segments.some((part) => part.startsWith(".")))
        return yield* invalid("Attachment paths cannot leave the task folder or name hidden files");
      if (segments.length === 1 && segments[0] === TASK_FILE)
        return yield* invalid(`${TASK_FILE} is the task itself, not an attachment`);
      const subtask = yield* Effect.orElseSucceed(
        fs.exists(path.join(dir, segments[0]!, TASK_FILE)),
        () => false,
      );
      if (subtask) return yield* invalid("That path is inside a subtask");
      if (!(yield* staysInFolder(dir, segments)))
        return yield* invalid("Attachment paths cannot follow symlinks out of the task folder");
      return { dir, segments };
    });

  /**
   * Whether the deepest existing part of `dir/segments` resolves, symlinks and all, to a place
   * inside `dir`, and the file itself is not a symlink.
   */
  const staysInFolder = (dir: string, segments: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      let deepest = dir;
      for (const [index, segment] of segments.entries()) {
        const next = path.join(deepest, segment);
        const info = yield* Effect.option(fs.lstat(next));
        if (Option.isNone(info)) break;
        if (info.value.type === "SymbolicLink" && index === segments.length - 1) return false;
        deepest = next;
      }
      const realDir = yield* storage("Could not read the task folder")(fs.realPath(dir));
      const real = yield* Effect.option(fs.realPath(deepest));
      return (
        Option.isSome(real) &&
        (real.value === realDir || real.value.startsWith(`${realDir}${path.sep}`))
      );
    });

  const attachmentPath = (taskId: string, relativePath: string) =>
    lock.withPermits(1)(
      Effect.map(attachmentTarget(taskId, relativePath), ({ dir, segments }) =>
        path.join(dir, ...segments),
      ),
    );

  const writeAttachment = (taskId: string, relativePath: string, bytes: Uint8Array) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const { dir, segments } = yield* attachmentTarget(taskId, relativePath);
        return yield* Effect.gen(function* () {
          // One level at a time, so a task folder that has gone is not created again.
          let folder = dir;
          for (const segment of segments.slice(0, -1)) {
            folder = path.join(folder, segment);
            if (!(yield* fs.exists(folder))) yield* fs.makeDirectory(folder);
          }
          const name = segments.at(-1)!;
          const free = yield* freeName(folder, name, path.extname(name));
          yield* writeAtomic(path.join(folder, free), bytes);
          return [...segments.slice(0, -1), free].join("/");
        }).pipe(storage("Could not save the attachment"));
      }),
    );

  if (options.watch === true) {
    yield* fs.watch(tasksDir, { recursive: true }).pipe(
      Stream.filter((event) => !event.path.endsWith(".tmp")),
      Stream.debounce("75 millis"),
      Stream.runForEach(() => Effect.andThen(invalidate, PubSub.publish(changes, undefined))),
      Effect.catch((error) => Effect.logWarning(`Stopped watching ${tasksDir}`, error)),
      Effect.forkScoped,
    );
  }

  return {
    id,
    root,
    snapshot: lock.withPermits(1)(current),
    getTask: (taskId) =>
      Effect.flatMap(lock.withPermits(1)(current), (snapshot) => findTask(snapshot, taskId)),
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    createList,
    moveList,
    reorderStatuses,
    attachmentPath,
    writeAttachment,
    changes: Stream.fromPubSub(changes),
  } satisfies Workspace;
});

export type MakeWorkspaceRequirements = FileSystem.FileSystem | Path.Path | Scope.Scope;
