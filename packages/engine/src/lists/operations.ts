import { Effect } from "effect";
import { basename, join, relative } from "node:path";
import { LIST_FILE, TASK_FILE } from "../layout.ts";
import type {
  CreateListInput,
  DeleteListInput,
  MoveListInput,
  RenameListInput,
  WorkspaceSnapshot,
} from "@octodo/contract";
import {
  MAX_LIST_DEPTH,
  inSubtree,
  listDepth,
  listMoveError,
  movedListId,
  slugify,
  taskSubtree,
} from "@octodo/contract/rules";
import { patchFrontmatter } from "../frontmatter.ts";
import { compareTasks, orderBetween } from "../place.ts";
import { fileText } from "../scan.ts";
import { containerDir, orderedLists, orderedTasks } from "../siblings.ts";
import { dropLinks } from "../tasks/operations.ts";
import { invalid, readBack, storageError, type State } from "../state.ts";
import { newListFile } from "./list-file.ts";

const findList = (snapshot: WorkspaceSnapshot, list: string) => {
  const found = snapshot.lists.find((known) => known.id === list);
  return found === undefined ? invalid(`Unknown list "${list}"`) : Effect.succeed(found);
};

const reread = (state: State, list: string) =>
  Effect.flatMap(state.scan, ({ snapshot }) => findList(snapshot, list)).pipe(readBack);

const exists = (state: State, path: string) =>
  storageError("Could not read the workspace")(state.storage.exists(path));

export const createList = (state: State, input: CreateListInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
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
        (yield* exists(state, join(dir, slug)))
      )
        return yield* invalid(`There is already a list "${listId}"`);
      yield* Effect.gen(function* () {
        const siblings = yield* orderedLists(files, scan, parent);
        const content = newListFile({ name: input.name, order: orderBetween(siblings, {}) });
        yield* files.createFolder(dir, slug, { name: LIST_FILE, content });
      }).pipe(storageError("Could not create the list"));
      return yield* reread(state, listId);
    }),
  );

const unreadListFile = (snapshot: WorkspaceSnapshot, dir: string) =>
  invalid(
    `${relative(snapshot.workspace.root, join(dir, LIST_FILE))} does not read; fix it before changing the list`,
  );

export const moveList = (state: State, listId: string, input: MoveListInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot, dirs } = scan;
      const list = yield* findList(snapshot, listId);
      const parent = input.parent === undefined ? list.parent : input.parent;
      if (parent !== null) yield* findList(snapshot, parent);
      const refused = listMoveError(snapshot.lists, listId, parent);
      if (refused !== null) return yield* invalid(refused);
      const { dir, order: own } = dirs.lists.get(listId)!;
      if (own === null) return yield* unreadListFile(snapshot, dir);
      const container = containerDir(scan, { list: parent, parent: null });
      const moved = join(container, basename(dir));
      if (parent !== list.parent && (yield* exists(state, moved)))
        return yield* invalid(
          `There is already a folder ${relative(snapshot.workspace.root, moved)}`,
        );
      yield* Effect.gen(function* () {
        const order = orderBetween(yield* orderedLists(files, scan, parent, listId), input);
        const file = join(dir, LIST_FILE);
        yield* files.writeFile(
          file,
          yield* patchFrontmatter(yield* fileText(scan, file), { order }),
        );
        if (parent !== list.parent) yield* files.moveFolder(dir, container);
      }).pipe(storageError("Could not move the list"));
      return yield* reread(state, movedListId(listId, parent));
    }),
  );

/** Writes the name into `list.md` and renames the folder to its slug, which may change the id. */
export const renameList = (state: State, listId: string, input: RenameListInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      const list = yield* findList(snapshot, listId);
      const { dir, order } = scan.dirs.lists.get(listId)!;
      if (order === null) return yield* unreadListFile(snapshot, dir);
      const slug = slugify(input.name);
      if (slug.length === 0) return yield* invalid("The list name needs a letter or digit");
      const renamed = list.parent === null ? slug : `${list.parent}/${slug}`;
      if (renamed !== listId && snapshot.lists.some((known) => known.id === renamed))
        return yield* invalid(`There is already a list "${renamed}"`);
      const folder = yield* Effect.gen(function* () {
        const file = join(dir, LIST_FILE);
        yield* files.writeFile(
          file,
          yield* patchFrontmatter(yield* fileText(scan, file), { name: input.name }),
        );
        return yield* files.renameFolder(dir, slug);
      }).pipe(storageError("Could not rename the list"));
      return yield* reread(
        state,
        list.parent === null ? basename(folder) : `${list.parent}/${basename(folder)}`,
      );
    }),
  );

/**
 * Removes the list's folder after taking its tasks out to the top level, or deleting them. A file
 * in it that is neither a task nor a list refuses the delete, so nothing the scan could not read is
 * lost; a crash leaves the tasks moved so far out, and a rerun moves the rest.
 */
export const deleteList = (state: State, listId: string, input: DeleteListInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot, dirs } = scan;
      yield* findList(snapshot, listId);
      const { dir, order } = dirs.lists.get(listId)!;
      if (order === null) return yield* unreadListFile(snapshot, dir);
      const inList = snapshot.tasks.filter(
        (task) => task.list !== null && inSubtree(task.list, listId),
      );
      const listFolder = `${relative(snapshot.workspace.root, dir)}/`;
      const taskFolders = inList.map((task) => task.path.slice(0, -TASK_FILE.length));
      const unread = snapshot.diagnostics.find(
        (diagnostic) =>
          diagnostic.path.startsWith(listFolder) &&
          !taskFolders.some((folder) => diagnostic.path.startsWith(folder)),
      );
      if (unread !== undefined)
        return yield* invalid(
          `${unread.path} is in the list but is not a task or a list; fix or move it before deleting the list`,
        );
      const listIndex = (list: string | null) =>
        snapshot.lists.findIndex((known) => known.id === list);
      const top = inList
        .filter((task) => task.parent === null)
        .toSorted(
          (a, b) =>
            listIndex(a.list) - listIndex(b.list) || compareTasks(snapshot.workspace.key)(a, b),
        );
      const deletedTasks = input.delete_tasks
        ? [...new Set(top.flatMap((task) => [...taskSubtree(snapshot.tasks, task.id)]))]
        : [];
      yield* Effect.gen(function* () {
        if (input.delete_tasks) {
          const removed = new Set(deletedTasks);
          yield* dropLinks(files, scan, (id) => removed.has(id));
        } else {
          const destination = { list: null, parent: null };
          const siblings = [...(yield* orderedTasks(files, scan, destination))];
          for (const task of top) {
            const order = orderBetween(siblings, {});
            siblings.push({ ...task, order });
            const text = yield* fileText(scan, join(snapshot.workspace.root, task.path));
            const moved = yield* files.moveFolder(
              dirs.tasks.get(task.id)!,
              containerDir(scan, destination),
            );
            yield* files.writeFile(
              join(moved, TASK_FILE),
              yield* patchFrontmatter(text, { order }),
            );
          }
        }
        yield* files.remove(dir);
      }).pipe(storageError("Could not delete the list"));
      return {
        deleted: listId,
        unlisted: input.delete_tasks ? [] : top.map((task) => task.id),
        deletedTasks,
      };
    }),
  );
