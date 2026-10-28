import { Effect, Exit, FileSystem, Path, PlatformError, type Schema } from "effect";
import type { WorkspaceConfig } from "../domain.ts";
import { configFile, editedConfig } from "./config.ts";

/**
 * Names of the temporary files and folders writes build and rename into place. Both are dot
 * names, which a scan never reads, and distinct enough that `removeLeftovers` takes only octodo's.
 */
export const tempName = {
  file: (name: string) => `.${name}.${crypto.randomUUID()}.tmp`,
  folder: () => `.new-${crypto.randomUUID()}`,
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEFTOVER = new RegExp(`^\\.(?:.+\\.${UUID}\\.tmp|new-${UUID})$`);

/** Whether `name` is one of octodo's temporary files or folders. */
export const isLeftover = (name: string): boolean => LEFTOVER.test(name);

/** Whether a file system call failed because its path is gone, as when another process moved it. */
export const isNotFound = (error: unknown): boolean =>
  PlatformError.isPlatformError(error) && error.reason._tag === "NotFound";

type Change<A = void> = Effect.Effect<A, PlatformError.PlatformError>;

/**
 * The only changes a write makes to `.octodo/`. Each one creates or replaces whole entries, so a
 * crash or a reader never sees half of one, and only inside folders that exist. Every path is
 * absolute.
 */
export interface Files {
  /** Replaces or creates `file` through a temporary sibling and a rename. */
  readonly writeFile: (file: string, content: string | Uint8Array) => Change;
  /**
   * Creates the file `name` in `dir`, or `name-2`, `name-3`, ... before its extension when that is
   * taken, and returns the name it got. It never replaces a file.
   */
  readonly createFile: (dir: string, name: string, content: Uint8Array) => Change<string>;
  /**
   * Builds a folder holding the file `marker` under a dot name and renames it into `container` as
   * `name`, or `name-2`, ... when that is taken, so no reader sees it without its marker. Returns
   * the folder's path.
   */
  readonly createFolder: (
    container: string,
    name: string,
    marker: { readonly name: string; readonly content: string },
  ) => Change<string>;
  /** Makes the empty folder `dir` in its existing parent, unless it is there. */
  readonly ensureFolder: (dir: string) => Change;
  /** Moves the folder `dir` into `container`, keeping its name when it is free. Returns its path. */
  readonly moveFolder: (dir: string, container: string) => Change<string>;
  /** Renames the folder `dir` to `name` unless that is taken. Returns the path it has. */
  readonly renameFolder: (dir: string, name: string) => Change<string>;
  /** Removes a file, or a folder with everything in it. */
  readonly remove: (path: string) => Change;
  /**
   * Sets the keys `edit` returns in config.json and keeps every other key, unknown ones included,
   * in its place. Fails on a config.json that does not read, so a broken file is reported, never
   * rewritten. Writes nothing when `edit` returns null.
   */
  readonly editConfig: (
    edit: (config: WorkspaceConfig) => Partial<WorkspaceConfig> | null,
  ) => Effect.Effect<void, PlatformError.PlatformError | Schema.SchemaError>;
}

/** Writes through a temporary sibling and a rename, so a crash or a reader never sees half a file. */
export const writeFileAtomic = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  file: string,
  content: string | Uint8Array,
): Change =>
  Effect.gen(function* () {
    const temp = path.join(path.dirname(file), tempName.file(path.basename(file)));
    if (typeof content === "string") yield* fs.writeFileString(temp, content);
    else yield* fs.writeFile(temp, content);
    yield* fs.rename(temp, file);
  });

/** `Files` on `fs` for the workspace at `root`, telling `changed` each path an operation touched. */
export const makeFiles = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  changed: (path: string) => void,
): Files => {
  /** Runs `change`, then reports the paths `touched` names for its result, or for its failure. */
  const reporting = <A>(
    change: Change<A>,
    touched: (result: A | undefined) => ReadonlyArray<string>,
  ): Change<A> =>
    Effect.onExit(change, (exit) =>
      Effect.sync(() => {
        for (const at of touched(Exit.isSuccess(exit) ? exit.value : undefined)) changed(at);
      }),
    );

  /** `name`, or `name-2`, `name-3`, ... before `extension`, whichever `dir` does not have yet. */
  const freeName = (dir: string, name: string, extension = "") =>
    Effect.gen(function* () {
      const stem = name.slice(0, name.length - extension.length);
      let candidate = name;
      for (let n = 2; yield* fs.exists(path.join(dir, candidate)); n++) {
        candidate = `${stem}-${n}${extension}`;
      }
      return candidate;
    });

  const writeFile: Files["writeFile"] = (file, content) =>
    reporting(writeFileAtomic(fs, path, file, content), () => [file]);

  return {
    writeFile,
    createFile: (dir, name, content) =>
      reporting(
        Effect.gen(function* () {
          const free = yield* freeName(dir, name, path.extname(name));
          yield* writeFileAtomic(fs, path, path.join(dir, free), content);
          return free;
        }),
        (free) => [free === undefined ? dir : path.join(dir, free)],
      ),
    createFolder: (container, name, marker) =>
      reporting(
        Effect.gen(function* () {
          const folder = path.join(container, yield* freeName(container, name));
          const temp = path.join(container, tempName.folder());
          yield* fs.makeDirectory(temp);
          yield* Effect.gen(function* () {
            yield* fs.writeFileString(path.join(temp, marker.name), marker.content);
            yield* fs.rename(temp, folder);
          }).pipe(Effect.onError(() => Effect.ignore(fs.remove(temp, { recursive: true }))));
          return folder;
        }),
        (folder) => [folder ?? container],
      ),
    ensureFolder: (dir) =>
      reporting(
        Effect.gen(function* () {
          if (!(yield* fs.exists(dir))) yield* fs.makeDirectory(dir);
        }),
        () => [dir],
      ),
    moveFolder: (dir, container) =>
      reporting(
        Effect.gen(function* () {
          if (path.dirname(dir) === container) return dir;
          const moved = path.join(container, yield* freeName(container, path.basename(dir)));
          yield* fs.rename(dir, moved);
          return moved;
        }),
        (moved) => [dir, moved ?? container],
      ),
    renameFolder: (dir, name) =>
      reporting(
        Effect.gen(function* () {
          const renamed = path.join(path.dirname(dir), name);
          if (renamed === dir || (yield* fs.exists(renamed))) return dir;
          yield* fs.rename(dir, renamed);
          return renamed;
        }),
        (renamed) => [dir, renamed ?? path.dirname(dir)],
      ),
    remove: (at) => reporting(fs.remove(at, { recursive: true }), () => [at]),
    editConfig: (edit) =>
      Effect.gen(function* () {
        const text = yield* editedConfig(root, edit);
        if (text !== null) yield* writeFile(configFile(path, root), text);
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
  };
};
