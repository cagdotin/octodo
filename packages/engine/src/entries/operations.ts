import { DateTime, Effect } from "effect";
import { join } from "node:path";
import { generateKeyBetween } from "fractional-indexing";
import { taskFolderName } from "../layout.ts";
import type { WorkspaceSnapshot } from "@octodo/contract";
import type { NewEntry } from "../plugins/plugin.ts";
import { invalid, nextId, readBack, storageError, type State } from "../state.ts";
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
