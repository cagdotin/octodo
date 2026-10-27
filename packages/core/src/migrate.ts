import { Effect, FileSystem, Path, PlatformError } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { StorageError } from "./domain.ts";
import { writeFileAtomic } from "./files.ts";
import { LIST_FILE, TASK_FILE, TASKS_DIR, humanize, legacyFolder } from "./layout.ts";
import { migratedTaskFile, patchFrontmatter } from "./markdown.ts";

export interface MigrationSummary {
  /** Task files turned into task folders. */
  readonly tasks: number;
  /** List folders renamed to their slug, with a `list.md`. */
  readonly lists: number;
  /** Emptied status folders removed. */
  readonly statusFolders: number;
  /** What was left as it was, and why. Paths are relative to the workspace root. */
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

export type OldLayoutFolder = NonNullable<ReturnType<typeof legacyFolder>>;

const isDirectory = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.stat(target)).type === "Directory";
});

/**
 * What a folder was in the old layout, or null when it is not old layout. Its name alone is not
 * enough, since a new list may be called `l-shaped-desk`: a status folder is numbered, has no
 * marker and is empty or holds `.md` files, and a list folder holds such folders (or is numbered,
 * unmarked and empty).
 */
export const oldLayoutFolder = (
  dir: string,
): Effect.Effect<
  OldLayoutFolder | null,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = legacyFolder(path.basename(dir));
    if (folder === null) return null;
    const names = (yield* fs.readDirectory(dir)).filter((name) => !name.startsWith("."));
    const has = (marker: string) => names.some((name) => name.toLowerCase() === marker);
    if (has(TASK_FILE)) return null;
    if (folder.type === "status") {
      const holdsTasks = names.length === 0 || names.some((name) => name.endsWith(".md"));
      return folder.position !== null && !has(LIST_FILE) && holdsTasks ? folder : null;
    }
    for (const name of names) {
      const child = path.join(dir, name);
      if ((yield* isDirectory(child)) && (yield* oldLayoutFolder(child)) !== null) return folder;
    }
    return names.length === 0 && folder.position !== null ? folder : null;
  });

/** The order key of the list numbered `position` in the old layout: a0, a1, a2, ... */
const orderAt = (position: number) => generateNKeysBetween(null, null, position + 1)[position]!;

/**
 * Converts the old layout in place: `s<NN>-x/ID-slug.md` becomes `ID-slug/task.md` with
 * `status: x`, and `l<NN>-slug/` becomes `slug/` with a `list.md`. Every step is derived from what
 * is on disk, so running it again finishes a run that stopped part-way and otherwise does nothing.
 * Folders of the new layout are left alone, whatever their names (see `oldLayoutFolder`).
 */
export const migrateWorkspace = (
  root: string,
): Effect.Effect<MigrationSummary, StorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const counts = { tasks: 0, lists: 0, statusFolders: 0 };
    const skipped: Array<{ path: string; reason: string }> = [];
    const skip = (absolute: string, reason: string) =>
      skipped.push({ path: path.relative(root, absolute), reason });

    /** Moves one task file into its own folder in `container`, or finishes a move a crash cut short. */
    const migrateTask = (container: string, file: string, status: string) =>
      Effect.gen(function* () {
        const name = path.basename(file, ".md");
        const text = yield* fs.readFileString(file);
        const migrated = yield* Effect.try({
          try: () => migratedTaskFile(text, status),
          catch: (error) => error,
        }).pipe(Effect.option);
        if (migrated._tag === "None") {
          skip(file, "Invalid frontmatter; fix it and run the migration again");
          return;
        }
        let target = path.join(container, name);
        for (let n = 2; yield* fs.exists(target); n++) {
          const existing = path.join(target, TASK_FILE);
          if (
            (yield* fs.exists(existing)) &&
            (yield* fs.readFileString(existing)) === migrated.value
          ) {
            yield* fs.remove(file);
            counts.tasks++;
            return;
          }
          target = path.join(container, `${name}-${n}`);
        }
        const temp = path.join(container, `.migrate-${name}`);
        if (yield* fs.exists(temp)) yield* fs.remove(temp, { recursive: true });
        yield* fs.makeDirectory(temp);
        yield* fs.writeFileString(path.join(temp, TASK_FILE), migrated.value);
        yield* fs.rename(temp, target);
        yield* fs.remove(file);
        counts.tasks++;
      });

    const migrateStatus = (container: string, dir: string, status: string) =>
      Effect.gen(function* () {
        for (const name of (yield* fs.readDirectory(dir)).toSorted()) {
          const file = path.join(dir, name);
          if (name.startsWith(".") || !name.endsWith(".md") || (yield* isDirectory(file))) continue;
          yield* migrateTask(container, file, status);
        }
        const left = (yield* fs.readDirectory(dir)).filter((name) => !name.startsWith("."));
        if (left.length > 0) {
          skip(dir, `Kept: it still holds ${left.join(", ")}`);
          return;
        }
        yield* fs.remove(dir, { recursive: true });
        counts.statusFolders++;
      });

    const migrateList = (
      container: string,
      dir: string,
      list: { readonly slug: string; readonly position: number | null },
    ) =>
      Effect.gen(function* () {
        const listFile = path.join(dir, LIST_FILE);
        if (!(yield* fs.exists(listFile))) {
          const order = list.position === null ? undefined : orderAt(list.position);
          yield* writeFileAtomic(
            listFile,
            patchFrontmatter(null, { name: humanize(list.slug), order }),
          );
        }
        const target = path.join(container, list.slug);
        if (yield* fs.exists(target)) {
          skip(dir, `Kept its name: ${path.relative(root, target)} already exists`);
          return dir;
        }
        yield* fs.rename(dir, target);
        counts.lists++;
        return target;
      });

    /** Converts what is directly in a list folder (or `.octodo/`), then the lists inside it. */
    const migrateContainer = (dir: string): Effect.Effect<void, unknown, never> =>
      Effect.gen(function* () {
        const lists: Array<string> = [];
        for (const name of (yield* fs.readDirectory(dir)).toSorted()) {
          const child = path.join(dir, name);
          if (name.startsWith(".") || !(yield* isDirectory(child))) continue;
          const old = yield* oldLayoutFolder(child);
          if (old?.type === "status") yield* migrateStatus(dir, child, old.slug);
          else if (old?.type === "list") lists.push(yield* migrateList(dir, child, old));
          else if (
            (yield* fs.exists(path.join(child, LIST_FILE))) &&
            !(yield* fs.exists(path.join(child, TASK_FILE)))
          )
            lists.push(child);
        }
        for (const list of lists) yield* migrateContainer(list);
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );

    yield* migrateContainer(path.join(root, TASKS_DIR)).pipe(
      Effect.mapError(
        (cause) => new StorageError({ message: "Could not migrate the workspace", cause }),
      ),
    );
    return { ...counts, skipped };
  });
