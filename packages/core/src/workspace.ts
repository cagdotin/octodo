import {
  DateTime,
  Effect,
  FileSystem,
  Option,
  Path,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import {
  DEFAULT_LIST_KINDS,
  DEFAULT_STATUSES,
  InvalidRequest,
  Priority,
  StorageError,
  TaskNotFound,
  WorkspaceConfig,
  type CreateListInput,
  type CreateTaskInput,
  type Diagnostic,
  type List,
  type MoveTaskInput,
  type StatusDefinition,
  type Task,
  type UpdateTaskInput,
  type WorkspaceInfo,
  type WorkspaceSnapshot,
} from "./domain.ts";
import {
  CONFIG_FILE,
  TASKS_DIR,
  classifyFolder,
  deriveKey,
  humanize,
  idNumber,
  slugify,
  statusFolder,
  taskFileName,
} from "./layout.ts";
import { parseTaskFile, writeTaskFile } from "./markdown.ts";

/** One workspace on disk: a folder with a `.tasks/` directory. The files are the source of truth. */
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
  readonly deleteTask: (id: string) => Effect.Effect<void, TaskNotFound | StorageError>;
  readonly createList: (
    input: CreateListInput,
  ) => Effect.Effect<List, InvalidRequest | StorageError>;
  /** Emits after files under `.tasks/` change, whoever changed them. Empty unless watching. */
  readonly changes: Stream.Stream<void>;
}

const MANAGED_KEYS = new Set([
  "id",
  "title",
  "priority",
  "tags",
  "due",
  "created",
  "updated",
  "order",
]);

const storage =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, StorageError, R> =>
    Effect.mapError(effect, (cause) => new StorageError({ message, cause }));

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkspaceConfig));
const decodePriority = Schema.decodeUnknownOption(Priority);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const compareTasks =
  (key: string) =>
  (a: Task, b: Task): number => {
    if (a.order !== b.order) {
      if (a.order === "") return 1;
      if (b.order === "") return -1;
      return a.order < b.order ? -1 : 1;
    }
    return (idNumber(a.id, key) ?? Infinity) - (idNumber(b.id, key) ?? Infinity);
  };

/** Creates `.tasks/` with a config and the default status folders. Leaves an existing one alone. */
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
    for (const status of DEFAULT_STATUSES) {
      yield* fs.makeDirectory(path.join(tasksDir, statusFolder(status.id)), { recursive: true });
    }
    yield* fs.writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`);
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
  const cache = yield* Ref.make(Option.none<WorkspaceSnapshot>());
  const changes = yield* PubSub.sliding<void>(16);

  const rel = (absolute: string) => path.relative(root, absolute);

  /** Writes through a temporary sibling and a rename, so readers and sync tools never see half a file. */
  const writeAtomic = (file: string, content: string) =>
    Effect.gen(function* () {
      const temp = path.join(
        path.dirname(file),
        `.${path.basename(file)}.${crypto.randomUUID()}.tmp`,
      );
      yield* fs.writeFileString(temp, content);
      yield* fs.rename(temp, file);
    });

  const readConfig = Effect.gen(function* () {
    const text = yield* fs.readFileString(path.join(tasksDir, CONFIG_FILE));
    return yield* decodeConfig(text);
  });

  const scan = Effect.gen(function* () {
    const diagnostics: Array<Diagnostic> = [];
    const config = yield* readConfig.pipe(
      Effect.catch((error) => {
        diagnostics.push({ path: path.join(TASKS_DIR, CONFIG_FILE), message: String(error) });
        const name = humanize(path.basename(root));
        return Effect.succeed<WorkspaceConfig>({ name, key: deriveKey(name) });
      }),
    );
    const listKinds = config.listKinds ?? DEFAULT_LIST_KINDS;
    const lists: Array<List> = [];
    const seenStatuses = new Set<string>();
    const files: Array<{ file: string; status: string; list: string | null }> = [];

    const walk = (
      dir: string,
      list: string | null,
      status: string | null,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        for (const name of (yield* fs.readDirectory(dir)).toSorted()) {
          const child = path.join(dir, name);
          const info = yield* fs.stat(child);
          const listId = path.relative(tasksDir, child);
          if (info.type === "File") {
            if (!name.endsWith(".md") || name.startsWith(".")) continue;
            if (status === null)
              diagnostics.push({
                path: rel(child),
                message: "Task file is not inside a status folder",
              });
            else files.push({ file: child, status, list });
            continue;
          }
          if (info.type !== "Directory") continue;
          const kind = classifyFolder(name, listKinds);
          if (kind.type === "ignored") continue;
          if (kind.type === "unknown") {
            diagnostics.push({ path: rel(child), message: "Folder name has no known prefix" });
          } else if (status !== null) {
            diagnostics.push({
              path: rel(child),
              message: "Folders inside a status folder are not read",
            });
          } else if (kind.type === "status") {
            seenStatuses.add(kind.id);
            yield* walk(child, list, kind.id);
          } else {
            lists.push({ id: listId, name: humanize(kind.slug), kind: kind.kind, parent: list });
            yield* walk(child, listId, null);
          }
        }
      });
    yield* walk(tasksDir, null, null);

    const statuses: Array<StatusDefinition> = [...(config.statuses ?? DEFAULT_STATUSES)];
    for (const status of seenStatuses) {
      if (!statuses.some((known) => known.id === status)) {
        statuses.push({ id: status, name: humanize(status), category: "unstarted" });
      }
    }

    const tasks: Array<Task> = [];
    const missingId: Array<{ file: string; text: string }> = [];
    const seenIds = new Set<string>();
    for (const { file, status, list } of files) {
      const text = yield* fs.readFileString(file);
      let parsed;
      try {
        parsed = parseTaskFile(text);
      } catch (error) {
        diagnostics.push({ path: rel(file), message: String(error) });
        continue;
      }
      const { data, body } = parsed;
      const taskId = stringOrNull(data["id"]);
      if (taskId === null) {
        missingId.push({ file, text });
        continue;
      }
      if (seenIds.has(taskId)) {
        diagnostics.push({
          path: rel(file),
          message: `Duplicate task id ${taskId}; this copy is ignored`,
        });
        continue;
      }
      seenIds.add(taskId);
      const tags = data["tags"];
      tasks.push({
        id: taskId,
        title: stringOrNull(data["title"]) ?? humanize(path.basename(file, ".md")),
        status,
        list,
        priority: Option.getOrElse(decodePriority(data["priority"]), () => "none" as const),
        tags: Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? [tags] : [],
        due: stringOrNull(data["due"]),
        created: stringOrNull(data["created"]),
        updated: stringOrNull(data["updated"]),
        order: stringOrNull(data["order"]) ?? "",
        body,
        path: rel(file),
        extra: Object.fromEntries(Object.entries(data).filter(([key]) => !MANAGED_KEYS.has(key))),
      });
    }

    // Files made by hand or by another tool get an id the first time the app sees them.
    let next = Math.max(0, ...tasks.map((task) => idNumber(task.id, config.key) ?? 0)) + 1;
    for (const { file, text } of missingId) {
      const assigned = `${config.key}-${next++}`;
      yield* writeAtomic(file, writeTaskFile(text, { id: assigned }));
      yield* Effect.logInfo(`Assigned ${assigned} to ${rel(file)}`);
    }
    if (missingId.length > 0) return yield* scanOnce;

    tasks.sort(compareTasks(config.key));
    const workspace: WorkspaceInfo = { id, name: config.name, key: config.key, root };
    return { workspace, statuses, lists, tasks, diagnostics } satisfies WorkspaceSnapshot;
  });
  // Assigning ids rewrites files, so the scan repeats once to read them back.
  const scanOnce: Effect.Effect<WorkspaceSnapshot, unknown> = Effect.suspend(() => scan);

  const current = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (Option.isSome(cached)) return cached.value;
    const fresh = yield* storage("Could not read the workspace")(scan);
    yield* Ref.set(cache, Option.some(fresh));
    return fresh;
  });

  const invalidate = Ref.set(cache, Option.none());

  const findTask = (snapshot: WorkspaceSnapshot, taskId: string) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    return task === undefined
      ? Effect.fail(new TaskNotFound({ id: taskId }))
      : Effect.succeed(task);
  };

  const checkPlace = (snapshot: WorkspaceSnapshot, status: string, list: string | null) =>
    Effect.gen(function* () {
      if (!snapshot.statuses.some((known) => known.id === status)) {
        return yield* new InvalidRequest({ message: `Unknown status "${status}"` });
      }
      if (list !== null && !snapshot.lists.some((known) => known.id === list)) {
        return yield* new InvalidRequest({ message: `Unknown list "${list}"` });
      }
    });

  const statusDir = (status: string, list: string | null) =>
    list === null
      ? path.join(tasksDir, statusFolder(status))
      : path.join(tasksDir, list, statusFolder(status));

  const tasksIn = (
    snapshot: WorkspaceSnapshot,
    status: string,
    list: string | null,
    except?: string,
  ) =>
    snapshot.tasks.filter(
      (task) => task.status === status && task.list === list && task.id !== except,
    );

  /** Gives every task in a column an order key, so a new key can be placed between any two. */
  const ensureOrdered = (column: ReadonlyArray<Task>) =>
    Effect.gen(function* () {
      if (column.every((task) => task.order !== "")) return column;
      const keys = generateNKeysBetween(null, null, column.length);
      const ordered: Array<Task> = [];
      for (const [index, task] of column.entries()) {
        const order = keys[index]!;
        const file = path.join(root, task.path);
        yield* writeAtomic(file, writeTaskFile(yield* fs.readFileString(file), { order }));
        ordered.push({ ...task, order });
      }
      return ordered;
    });

  const orderBetween = (
    column: ReadonlyArray<Task>,
    input: { before?: string; after?: string },
  ) => {
    if (input.before !== undefined) {
      const index = column.findIndex((task) => task.id === input.before);
      if (index !== -1)
        return generateKeyBetween(column[index - 1]?.order ?? null, column[index]!.order);
    }
    if (input.after !== undefined) {
      const index = column.findIndex((task) => task.id === input.after);
      if (index !== -1)
        return generateKeyBetween(column[index]!.order, column[index + 1]?.order ?? null);
    }
    return generateKeyBetween(column.at(-1)?.order ?? null, null);
  };

  const uniqueFile = (dir: string, name: string) =>
    Effect.gen(function* () {
      let candidate = path.join(dir, name);
      for (let n = 2; yield* fs.exists(candidate); n++) {
        candidate = path.join(dir, name.replace(/\.md$/, `-${n}.md`));
      }
      return candidate;
    });

  /** Serialises writes and drops the cache afterwards, whatever happened. */
  const write = <A, E>(effect: Effect.Effect<A, E>) =>
    lock.withPermits(1)(Effect.ensuring(effect, invalidate));

  const reread = (taskId: string) =>
    Effect.flatMap(current, (snapshot) => findTask(snapshot, taskId));

  const createTask = (input: CreateTaskInput) =>
    write(
      Effect.gen(function* () {
        const snapshot = yield* current;
        const list = input.list ?? null;
        const status =
          input.status ??
          (
            snapshot.statuses.find((known) => known.category === "unstarted") ??
            snapshot.statuses[0]
          )?.id;
        if (status === undefined)
          return yield* new InvalidRequest({ message: "The workspace has no statuses" });
        yield* checkPlace(snapshot, status, list);
        const { key } = snapshot.workspace;
        const taskId = `${key}-${Math.max(0, ...snapshot.tasks.map((task) => idNumber(task.id, key) ?? 0)) + 1}`;
        const column = yield* storage("Could not order tasks")(
          ensureOrdered(tasksIn(snapshot, status, list)),
        );
        const now = yield* nowIso;
        const content = writeTaskFile(
          null,
          {
            id: taskId,
            title: input.title,
            priority: input.priority ?? "none",
            tags: input.tags ?? [],
            due: input.due ?? undefined,
            created: now,
            updated: now,
            order: orderBetween(column, {}),
          },
          input.body ?? "",
        );
        const dir = statusDir(status, list);
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(dir, { recursive: true });
          yield* writeAtomic(yield* uniqueFile(dir, taskFileName(taskId, input.title)), content);
        }).pipe(storage("Could not write the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const updateTask = (taskId: string, input: UpdateTaskInput) =>
    write(
      Effect.gen(function* () {
        const task = yield* findTask(yield* current, taskId);
        const file = path.join(root, task.path);
        yield* Effect.gen(function* () {
          const text = yield* fs.readFileString(file);
          const changes: Record<string, unknown> = { updated: yield* nowIso };
          if (input.title !== undefined) changes["title"] = input.title;
          if (input.priority !== undefined) changes["priority"] = input.priority;
          if (input.tags !== undefined) changes["tags"] = input.tags;
          if (input.due !== undefined) changes["due"] = input.due ?? undefined;
          yield* writeAtomic(file, writeTaskFile(text, changes, input.body));
        }).pipe(storage("Could not write the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const moveTask = (taskId: string, input: MoveTaskInput) =>
    write(
      Effect.gen(function* () {
        const snapshot = yield* current;
        const task = yield* findTask(snapshot, taskId);
        const status = input.status ?? task.status;
        const list = input.list === undefined ? task.list : input.list;
        yield* checkPlace(snapshot, status, list);
        yield* Effect.gen(function* () {
          const column = yield* ensureOrdered(tasksIn(snapshot, status, list, taskId));
          const order = orderBetween(column, input);
          let file = path.join(root, task.path);
          const dir = statusDir(status, list);
          if (dir !== path.dirname(file)) {
            yield* fs.makeDirectory(dir, { recursive: true });
            const target = yield* uniqueFile(dir, path.basename(file));
            yield* fs.rename(file, target);
            file = target;
          }
          const text = yield* fs.readFileString(file);
          yield* writeAtomic(file, writeTaskFile(text, { order, updated: yield* nowIso }));
        }).pipe(storage("Could not move the task"));
        yield* invalidate;
        return yield* reread(taskId).pipe(Effect.orDie);
      }),
    );

  const deleteTask = (taskId: string) =>
    write(
      Effect.gen(function* () {
        const task = yield* findTask(yield* current, taskId);
        yield* storage("Could not delete the task")(fs.remove(path.join(root, task.path)));
      }),
    );

  const createList = (input: CreateListInput) =>
    write(
      Effect.gen(function* () {
        const snapshot = yield* current;
        const parent = input.parent ?? null;
        const config = yield* storage("Could not read the workspace config")(readConfig);
        if (!(input.kind in (config.listKinds ?? DEFAULT_LIST_KINDS))) {
          return yield* new InvalidRequest({ message: `Unknown list kind "${input.kind}"` });
        }
        if (parent !== null && !snapshot.lists.some((known) => known.id === parent)) {
          return yield* new InvalidRequest({ message: `Unknown list "${parent}"` });
        }
        const slug = slugify(input.name);
        if (slug.length === 0)
          return yield* new InvalidRequest({ message: "The list name needs a letter or digit" });
        const folder = `${input.kind}-${slug}`;
        const listId = parent === null ? folder : path.join(parent, folder);
        yield* storage("Could not create the list")(
          fs.makeDirectory(path.join(tasksDir, listId), { recursive: true }),
        );
        return { id: listId, name: humanize(slug), kind: input.kind, parent } satisfies List;
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
    changes: Stream.fromPubSub(changes),
  } satisfies Workspace;
});

export type MakeWorkspaceRequirements = FileSystem.FileSystem | Path.Path | Scope.Scope;
