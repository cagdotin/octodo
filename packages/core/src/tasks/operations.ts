import { DateTime, Effect } from "effect";
import { join } from "node:path";
import {
  TaskNotFound,
  type CreateTaskInput,
  type MoveTaskInput,
  type Task,
  type UpdateTaskInput,
  type WorkspaceSnapshot,
} from "../domain.ts";
import { patchFrontmatter } from "../frontmatter.ts";
import { LINK_KINDS, TASK_FILE, defaultStatus, taskFolderName, taskSubtree } from "../layout.ts";
import { TOP, destination, orderBetween } from "../place.ts";
import { fileText } from "../scan.ts";
import { containerDir, orderedTasks } from "../siblings.ts";
import { invalid, nextId, readBack, storageError, type State } from "../state.ts";
import { editTaskFile, keepLinks, newTaskFile } from "./task-file.ts";

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

export const createTask = (state: State, input: CreateTaskInput) =>
  state.write((files, ids) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
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
        yield* files.writeFile(join(dir, TASK_FILE), editTaskFile(text, input));
      }).pipe(storageError("Could not write the task"));
      return yield* reread(state, taskId);
    }),
  );

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
      yield* Effect.gen(function* () {
        const changes: Record<string, string> = {};
        if (input.status !== undefined) changes["status"] = input.status;
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
        yield* files.writeFile(join(dir, TASK_FILE), patchFrontmatter(text, changes));
      }).pipe(storageError("Could not move the task"));
      return yield* reread(state, taskId);
    }),
  );

export const deleteTask = (state: State, taskId: string) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot, dirs } = scan;
      yield* findTask(snapshot, taskId);
      const removed = taskSubtree(snapshot.tasks, taskId);
      const isRemoved = (id: string) => removed.has(id);
      const linking = snapshot.tasks.filter(
        (task) =>
          !removed.has(task.id) && LINK_KINDS.some((kind) => task[kind.forward].some(isRemoved)),
      );
      yield* Effect.gen(function* () {
        for (const task of linking) {
          const file = join(snapshot.workspace.root, task.path);
          const original = yield* fileText(scan, file);
          const text = LINK_KINDS.reduce(
            (text, kind) =>
              keepLinks(text, kind.field, (id) => !isRemoved(id), snapshot.workspace.key) ?? text,
            original,
          );
          if (text !== original) yield* files.writeFile(file, text);
        }
        yield* files.remove(dirs.tasks.get(taskId)!);
      }).pipe(storageError("Could not delete the task"));
    }),
  );
