import { DateTime, Effect } from "effect";
import { basename, join } from "node:path";
import { generateKeyBetween } from "fractional-indexing";
import { taskFolderName } from "../layout.ts";
import { EntryNotFound, type WorkspaceSnapshot } from "@octodo/contract";
import { patchFrontmatter } from "../frontmatter.ts";
import type { EntryChange, NewEntry } from "../plugins/plugin.ts";
import { fileText } from "../scan.ts";
import { invalid, nextId, readBack, storageError, type State } from "../state.ts";
import { changedFiles, checkKind, dropLinks, writeChangedFiles } from "../tasks/operations.ts";
import { newEntryFile } from "./entry-file.ts";

const findEntry = (snapshot: WorkspaceSnapshot, id: string) => {
  const entry = snapshot.entries?.find((candidate) => candidate.id === id);
  return entry === undefined
    ? Effect.fail(new Error(`The entry ${id} was not read back`))
    : Effect.succeed(entry);
};

/**
 * Creates an entry in the section of the plugin `id`, after every entry with an order key. The
 * section's folder is made with its first entry, inside `.octodo/`, which exists.
 */
export const createEntry = (
  state: State,
  id: string,
  input: NewEntry,
  keys: Readonly<Record<string, unknown>>,
) =>
  state.write((files, ids) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      const plugin = state.plugins.find((candidate) => candidate.shared.id === id);
      const section = plugin?.shared.section;
      if (plugin === undefined || section === undefined || !snapshot.plugins?.includes(id))
        return yield* invalid(`The ${id} plugin adds no section this workspace enables`);
      const foreign = Object.keys(keys).filter((key) => !(key in plugin.shared.keys.fields));
      if (foreign.length > 0)
        return yield* invalid(`The ${id} plugin does not own ${foreign.join(", ")}`);
      const entryId = nextId(ids, scan);
      const last = (snapshot.entries ?? [])
        .filter((entry) => entry.section === id && entry.order !== "")
        .at(-1)?.order;
      yield* Effect.gen(function* () {
        const dir = join(scan.tree.path, id);
        const content = newEntryFile(input, {
          id: entryId,
          keys,
          order: generateKeyBetween(last ?? null, null),
          now: DateTime.formatIso(yield* DateTime.now),
        });
        yield* files.ensureFolder(dir);
        yield* files.createFolder(dir, taskFolderName(entryId, input.title), {
          name: section.marker,
          content,
        });
      }).pipe(storageError("Could not write the entry"));
      return yield* Effect.flatMap(state.scan, ({ snapshot }) => findEntry(snapshot, entryId)).pipe(
        readBack,
      );
    }),
  );

/** The entry `entryId` of the section of the plugin `section`. */
export const findInSection = (snapshot: WorkspaceSnapshot, section: string, entryId: string) => {
  const entry = snapshot.entries?.find(
    (candidate) => candidate.id === entryId && candidate.section === section,
  );
  return entry === undefined
    ? Effect.fail(new EntryNotFound({ id: entryId, section }))
    : Effect.succeed(entry);
};

const rereadEntry = (state: State, section: string, entryId: string) =>
  Effect.flatMap(state.scan, ({ snapshot }) => findInSection(snapshot, section, entryId)).pipe(
    readBack,
  );

/**
 * Writes an entry of the plugin `section`'s section: its plugin's files first, then its marker
 * file's title, body and plugin keys, renaming its folder for a new title.
 */
export const editEntry = (state: State, section: string, entryId: string, change: EntryChange) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      const { snapshot } = scan;
      const entry = yield* findInSection(snapshot, section, entryId);
      yield* checkKind(state, snapshot, section, change);
      const dir = scan.dirs.entries.get(entryId)!;
      const read = yield* changedFiles(state, scan, { id: entryId, dir }, change);
      const marker = join(snapshot.workspace.root, entry.path);
      yield* Effect.gen(function* () {
        yield* writeChangedFiles(files, dir, change, read);
        const text = yield* fileText(scan, marker);
        const renamed =
          change.title === undefined
            ? dir
            : yield* files.renameFolder(dir, taskFolderName(entryId, change.title));
        const keys =
          change.title === undefined ? change.keys : { ...change.keys, title: change.title };
        if (keys !== undefined || change.body !== undefined)
          yield* files.writeFile(
            join(renamed, basename(marker)),
            yield* patchFrontmatter(text, keys ?? {}, change.body),
          );
      }).pipe(storageError("Could not write the entry"));
      return yield* rereadEntry(state, section, entryId);
    }),
  );

/** Removes an entry's folder, after taking its id out of every task's links. */
export const deleteEntry = (state: State, section: string, entryId: string) =>
  state.write((files) =>
    Effect.gen(function* () {
      const scan = yield* state.scan;
      yield* findInSection(scan.snapshot, section, entryId);
      yield* Effect.gen(function* () {
        yield* dropLinks(files, scan, (id) => id === entryId);
        yield* files.remove(scan.dirs.entries.get(entryId)!);
      }).pipe(storageError("Could not delete the entry"));
    }),
  );

/** The text of the plugin `section`'s files in one of its entries, as the last scan read them. */
export const entryFiles = (state: State, section: string, entryId: string) =>
  state.read(
    Effect.gen(function* () {
      const scan = yield* state.scan;
      yield* findInSection(scan.snapshot, section, entryId);
      return scan.kindFiles.get(entryId) ?? new Map<string, string>();
    }),
  );
