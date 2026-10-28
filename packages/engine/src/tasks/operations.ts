import { DateTime, Effect } from "effect";
import { join } from "node:path";
import { TASK_FILE, taskFolderName } from "../layout.ts";
import {
  TaskNotFound,
  type CreateTaskInput,
  type MoveTaskInput,
  type Task,
  type UpdateTaskInput,
  type WorkspaceSnapshot,
} from "@octodo/contract";
import {
  LINK_KINDS,
  defaultStatus,
  destination,
  type Container,
  taskSubtree,
} from "@octodo/contract/rules";
import { patchFrontmatter } from "../frontmatter.ts";
import { orderBetween } from "../place.ts";
import { fileText, type Scan } from "../scan.ts";
import { containerDir, orderedTasks } from "../siblings.ts";
import { invalid, nextId, readBack, storageError, type State } from "../state.ts";
import type { KindChange } from "../plugins/plugin.ts";
import type { Files } from "../storage/files.ts";
import { editTaskFile, keepLinks, newTaskFile, type NewKind } from "./task-file.ts";

const TOP: Container = { list: null, parent: null };

export const findTask = (snapshot: WorkspaceSnapshot, taskId: string) => {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  return task === undefined ? Effect.fail(new TaskNotFound({ id: taskId })) : Effect.succeed(task);
};

export const getTask = (state: State, taskId: string) =>
  Effect.flatMap(state.read(state.scan), ({ snapshot }) => findTask(snapshot, taskId));

const reread = (state: State, taskId: string) =>
  Effect.flatMap(state.scan, ({ snapshot }) => findTask(snapshot, taskId)).pipe(readBack);

const checkStatus = (snapshot: WorkspaceSnapshot, status: string) =>
  snapshot.statuses.some((known) => known.id === status)
    ? Effect.void
    : invalid(`Unknown status "${status}"`);

const placed = (
  snapshot: WorkspaceSnapshot,
  input: Parameters<typeof destination>[1],
  from = TOP,
) => {
  const container = destination(snapshot, input, from);
  return typeof container === "string" ? invalid(container) : Effect.succeed(container);
};

/**
 * The ids a link field gets: each once, none of them the task's own, and each an existing task or
 * one the field already had.
 */
const checkLinks = (snapshot: WorkspaceSnapshot, task: Task, ids: ReadonlyArray<string>) => {
  const known = new Set([...snapshot.tasks.map(({ id }) => id), ...task.blockedBy]);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) return invalid(`Unknown task ${unknown.join(", ")}`);
  if (ids.includes(task.id)) return invalid("A task cannot be linked to itself");
  return Effect.succeed([...new Set(ids)]);
};

/** Refuses a change of keys or files that the plugin `id` does not own, or a plugin not enabled. */
export const checkKind = (
  state: State,
  snapshot: WorkspaceSnapshot,
  id: string,
  change: { readonly keys?: object | undefined; readonly files?: object | undefined },
) => {
  const plugin = state.plugins.find((candidate) => candidate.shared.id === id);
  if (plugin === undefined || !(snapshot.plugins ?? []).includes(id))
    return invalid(`The ${id} plugin is not enabled in this workspace`);
  const foreign = [
    ...Object.keys(change.keys ?? {}).filter((key) => !(key in plugin.shared.keys.fields)),
    ...Object.keys(change.files ?? {}).filter((file) => !plugin.shared.files.includes(file)),
  ];
  return foreign.length === 0
    ? Effect.void
    : invalid(`The ${id} plugin does not own ${foreign.join(", ")}`);
};

export const createTask = (state: State, input: CreateTaskInput, kind?: NewKind) =>
  state.write((files, ids) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      if (kind !== undefined) yield* checkKind(state, snapshot, kind.id, kind);
      const status = input.status ?? defaultStatus(snapshot.statuses)?.id;
      if (status === undefined) return yield* invalid("The workspace has no statuses");
      yield* checkStatus(snapshot, status);
      const container = yield* placed(snapshot, input);
      const taskId = nextId(ids, scan);
      yield* Effect.gen(function* () {
        const siblings = yield* orderedTasks(files, scan, container);
        const content = newTaskFile(input, {
          id: taskId,
          status,
          order: orderBetween(siblings, {}),
          now: DateTime.formatIso(yield* DateTime.now),
          kind,
        });
        yield* files.createFolder(
          containerDir(scan, container),
          taskFolderName(taskId, input.title),
          { name: TASK_FILE, content },
        );
      }).pipe(storageError("Could not write the task"));
      return yield* reread(state, taskId);
    }),
  );

export const updateTask = (state: State, taskId: string, given: UpdateTaskInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot, dirs } = scan;
      const task = yield* findTask(snapshot, taskId);
      const input =
        given.blocked_by === undefined
          ? given
          : { ...given, blocked_by: yield* checkLinks(snapshot, task, given.blocked_by) };
      yield* Effect.gen(function* () {
        const text = yield* fileText(scan, join(snapshot.workspace.root, task.path));
        const dir =
          input.title === undefined
            ? dirs.tasks.get(taskId)!
            : yield* files.renameFolder(
                dirs.tasks.get(taskId)!,
                taskFolderName(taskId, input.title),
              );
        yield* files.writeFile(join(dir, TASK_FILE), yield* editTaskFile(text, input));
      }).pipe(storageError("Could not write the task"));
      return yield* reread(state, taskId);
    }),
  );

/**
 * The text of each file `change` rewrites in the task's folder, as the scan read it, refusing a
 * file on disk the scan could not read, so a change never builds on a file it has not seen.
 */
export const changedFiles = (
  state: State,
  scan: Scan,
  { id, dir }: { readonly id: string; readonly dir: string },
  change: KindChange,
) =>
  Effect.gen(function* () {
    const read = scan.kindFiles.get(id) ?? new Map<string, string>();
    for (const name of Object.keys(change.files ?? {}))
      if (
        !read.has(name) &&
        (yield* state.storage
          .exists(join(dir, name))
          .pipe(storageError("Could not read the task folder")))
      )
        return yield* invalid(`${name} could not be read, so it is not changed`);
    return read;
  });

export const writeChangedFiles = (
  files: Files,
  dir: string,
  change: KindChange,
  read: ReadonlyMap<string, string>,
) =>
  Effect.forEach(
    Object.entries(change.files ?? {}),
    ([name, next]) => files.writeFile(join(dir, name), next(read.get(name) ?? null)),
    { discard: true },
  );

const ofKind = (snapshot: WorkspaceSnapshot, id: string, taskId: string) =>
  Effect.flatMap(findTask(snapshot, taskId), (task) =>
    task.kind?.id === id
      ? Effect.succeed(task)
      : invalid(`${taskId} is not a task of the ${id} kind`),
  );

/** Writes the plugin `id`'s keys and files of a task of its kind, the files before `task.md`. */
export const editKind = (state: State, id: string, taskId: string, change: KindChange) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      const task = yield* ofKind(snapshot, id, taskId);
      yield* checkKind(state, snapshot, id, change);
      const read = yield* changedFiles(
        state,
        scan,
        { id: taskId, dir: scan.dirs.tasks.get(taskId)! },
        change,
      );
      yield* Effect.gen(function* () {
        yield* writeChangedFiles(files, scan.dirs.tasks.get(taskId)!, change, read);
        if (change.keys !== undefined) {
          const file = join(snapshot.workspace.root, task.path);
          yield* files.writeFile(
            file,
            yield* patchFrontmatter(yield* fileText(scan, file), change.keys),
          );
        }
      }).pipe(storageError("Could not write the task"));
      return yield* reread(state, taskId);
    }),
  );

/** The text of the plugin `id`'s files in a task of its kind, as the last scan read them. */
export const kindFiles = (state: State, id: string, taskId: string) =>
  state.read(
    Effect.gen(function* () {
      const scan = yield* state.scan;
      yield* ofKind(scan.snapshot, id, taskId);
      return scan.kindFiles.get(taskId) ?? new Map<string, string>();
    }),
  );

/**
 * What a move into `status` writes for a task whose kind completes in place: its plugin's change
 * and the first unstarted status, or nothing when the move does not complete such a task.
 */
const completion = Effect.fnUntraced(function* (
  state: State,
  snapshot: WorkspaceSnapshot,
  task: Task,
  status: string | undefined,
) {
  const plugin = state.plugins.find((candidate) => candidate.shared.id === task.kind?.id);
  const category = snapshot.statuses.find((known) => known.id === status)?.category;
  if (plugin?.complete === undefined || category !== "completed") return null;
  const at = `${DateTime.formatIso(yield* DateTime.now).slice(0, 16)}:00Z`;
  return {
    change: plugin.complete(at),
    status: defaultStatus(snapshot.statuses)?.id ?? task.status,
  };
});

/**
 * A task whose kind completes in place (a recurring task) moved into a completed status gets its
 * plugin's change instead, and the first unstarted status.
 */
export const moveTask = (state: State, taskId: string, input: MoveTaskInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      const task = yield* findTask(snapshot, taskId);
      yield* checkStatus(snapshot, input.status ?? task.status);
      const container = yield* placed(snapshot, input, task);
      if (container.parent !== null && taskSubtree(snapshot.tasks, taskId).has(container.parent))
        return yield* invalid("A task cannot move inside itself or its subtasks");
      const completed = yield* completion(state, snapshot, task, input.status);
      const read =
        completed === null
          ? null
          : yield* changedFiles(
              state,
              scan,
              { id: taskId, dir: scan.dirs.tasks.get(taskId)! },
              completed.change,
            );
      const status = completed?.status ?? input.status;
      yield* Effect.gen(function* () {
        const changes: Record<string, string> = {};
        if (status !== undefined) changes["status"] = status;
        const placedAmong = input.before !== undefined || input.after !== undefined;
        if (placedAmong || container.list !== task.list || container.parent !== task.parent)
          changes["order"] = orderBetween(
            yield* orderedTasks(files, scan, container, taskId),
            input,
          );
        const text = yield* fileText(scan, join(snapshot.workspace.root, task.path));
        const dir = yield* files.moveFolder(
          scan.dirs.tasks.get(taskId)!,
          containerDir(scan, container),
        );
        if (completed !== null) yield* writeChangedFiles(files, dir, completed.change, read!);
        yield* files.writeFile(join(dir, TASK_FILE), yield* patchFrontmatter(text, changes));
      }).pipe(storageError("Could not move the task"));
      return yield* reread(state, taskId);
    }),
  );

/**
 * Takes the ids `isRemoved` accepts out of every other task's links, rewriting only the files that
 * still have one, so a rerun after a crash finishes the cleanup.
 */
export const dropLinks = (files: Files, scan: Scan, isRemoved: (id: string) => boolean) =>
  Effect.gen(function* () {
    const { snapshot } = scan;
    const linking = snapshot.tasks.filter(
      (task) =>
        !isRemoved(task.id) && LINK_KINDS.some((kind) => task[kind.forward].some(isRemoved)),
    );
    for (const task of linking) {
      const file = join(snapshot.workspace.root, task.path);
      const original = yield* fileText(scan, file);
      let text = original;
      for (const kind of LINK_KINDS)
        text =
          (yield* keepLinks(text, kind.field, (id) => !isRemoved(id), snapshot.workspace.key)) ??
          text;
      if (text !== original) yield* files.writeFile(file, text);
    }
  });

export const deleteTask = (state: State, taskId: string) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot, dirs } = scan;
      yield* findTask(snapshot, taskId);
      const removed = taskSubtree(snapshot.tasks, taskId);
      yield* Effect.gen(function* () {
        yield* dropLinks(files, scan, (id) => removed.has(id));
        yield* files.remove(dirs.tasks.get(taskId)!);
      }).pipe(storageError("Could not delete the task"));
    }),
  );
