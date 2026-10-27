import { Effect, FileSystem, Option, Path, PlatformError } from "effect";

/**
 * Names of octodo's own bookkeeping files and folders: the temporary ones writes build and rename
 * into place, id claims and pending-id markers. All are dot names, which a scan never reads, and
 * each is distinct enough that `removeLeftovers` takes only octodo's own.
 */
export const tempName = {
  file: (name: string) => `.${name}.${crypto.randomUUID()}.tmp`,
  folder: () => `.new-${crypto.randomUUID()}`,
  /** A migration names its temporary folders after its run, so two runs never share one. */
  migration: (run: string, name: string) => `.migrate-${run}-${name}`,
  /** The file in `.octodo/` whose exclusive creation reserves task id `id` for one process. */
  claim: (id: string) => `.claim-${id}`,
  /** The file in a task folder naming the id being written into its `task.md`. */
  pendingId: ".pending-id",
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEFTOVER = new RegExp(
  `^\\.(?:.+\\.${UUID}\\.tmp|new-${UUID}|migrate-${UUID}-.+|claim-.+-\\d+|pending-id)$`,
);

/** How old a temporary file must be before it is taken as a crash's leftover, not a write in progress. */
const STALE_AFTER_MS = 60_000;

/**
 * Removes the temporary files and folders under `dir` that a crashed write or migration left,
 * once they are old enough that no live writer in another process still owns them.
 */
export const removeLeftovers = (
  dir: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const name of yield* fs.readDirectory(dir)) {
      const child = path.join(dir, name);
      yield* Effect.gen(function* () {
        const info = yield* fs.lstat(child);
        if (LEFTOVER.test(name)) {
          const modified = Option.getOrElse(info.mtime, () => new Date());
          if (Date.now() - modified.getTime() > STALE_AFTER_MS)
            yield* fs.remove(child, { recursive: true });
        } else if (!name.startsWith(".") && info.type === "Directory") {
          yield* removeLeftovers(child);
        }
      }).pipe(Effect.ignore);
    }
  }).pipe(Effect.ignore);

/** Writes through a temporary sibling and a rename, so readers and sync tools never see half a file. */
export const writeFileAtomic = Effect.fnUntraced(function* (
  file: string,
  content: string | Uint8Array,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temp = path.join(path.dirname(file), tempName.file(path.basename(file)));
  if (typeof content === "string") yield* fs.writeFileString(temp, content);
  else yield* fs.writeFile(temp, content);
  yield* fs.rename(temp, file);
});

/** Whether a file system call failed because its path is gone, as when another process moved it. */
export const isNotFound = (error: unknown): boolean =>
  PlatformError.isPlatformError(error) && error.reason._tag === "NotFound";

/** Whether two folders hold the same names and bytes all the way down, hidden entries aside. */
export const sameTree = (
  a: string,
  b: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const [infoA, infoB] = [yield* fs.stat(a), yield* fs.stat(b)];
    if (infoA.type !== infoB.type) return false;
    if (infoA.type === "File") {
      const [bytesA, bytesB] = [yield* fs.readFile(a), yield* fs.readFile(b)];
      return bytesA.length === bytesB.length && bytesA.every((byte, i) => byte === bytesB[i]);
    }
    const visible = (names: ReadonlyArray<string>) =>
      names.filter((name) => !name.startsWith(".")).toSorted();
    const [namesA, namesB] = [
      visible(yield* fs.readDirectory(a)),
      visible(yield* fs.readDirectory(b)),
    ];
    if (namesA.join("/") !== namesB.join("/")) return false;
    for (const name of namesA) {
      if (!(yield* sameTree(path.join(a, name), path.join(b, name)))) return false;
    }
    return true;
  });

/** `name`, or `name-2`, `name-3`, ... before the extension, whichever `dir` does not have yet. */
export const freeName = Effect.fnUntraced(function* (dir: string, name: string, extension = "") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
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
export const createFolder = Effect.fnUntraced(function* (
  container: string,
  name: string,
  marker: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temp = path.join(container, tempName.folder());
  yield* fs.makeDirectory(temp);
  yield* Effect.gen(function* () {
    yield* fs.writeFileString(path.join(temp, marker), content);
    yield* fs.rename(temp, path.join(container, name));
  }).pipe(Effect.onError(() => Effect.ignore(fs.remove(temp, { recursive: true }))));
});
