import { Effect } from "effect";
import { basename, join, relative } from "node:path";
import { LIST_FILE } from "../layout.ts";
import type { CreateListInput, MoveListInput, WorkspaceSnapshot } from "@octodo/contract";
import {
  MAX_LIST_DEPTH,
  listDepth,
  listMoveError,
  movedListId,
  slugify,
} from "@octodo/contract/rules";
import { patchFrontmatter } from "../frontmatter.ts";
import { orderBetween } from "../place.ts";
import { fileText } from "../scan.ts";
import { containerDir, orderedLists } from "../siblings.ts";
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
      const dir = dirs.lists.get(listId)!.dir;
      const container = containerDir(scan, { list: parent, parent: null });
      const moved = join(container, basename(dir));
      if (parent !== list.parent && (yield* exists(state, moved)))
        return yield* invalid(
          `There is already a folder ${relative(snapshot.workspace.root, moved)}`,
        );
      yield* Effect.gen(function* () {
        const order = orderBetween(yield* orderedLists(files, scan, parent, listId), input);
        const file = join(dir, LIST_FILE);
        yield* files.writeFile(file, patchFrontmatter(yield* fileText(scan, file), { order }));
        if (parent !== list.parent) yield* files.moveFolder(dir, container);
      }).pipe(storageError("Could not move the list"));
      return yield* reread(state, movedListId(listId, parent));
    }),
  );
