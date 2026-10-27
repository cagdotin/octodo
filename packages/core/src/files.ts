import { Effect, FileSystem, Option, Path, PlatformError } from "effect";

/**
 * Names of the temporary files and folders that writes build and rename into place. Each holds a
 * random UUID, so `removeLeftovers` takes only octodo's own.
 */
export const tempName = {
  file: (name: string) => `.${name}.${crypto.randomUUID()}.tmp`,
  folder: () => `.new-${crypto.randomUUID()}`,
  /** A migration names its temporary folders after its run, so two runs never share one. */
  migration: (run: string, name: string) => `.migrate-${run}-${name}`,
  /** The file in `.octodo/` whose exclusive creation reserves task id `id` for one process. */
  claim: (id: string) => `.claim-${id}`,
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEFTOVER = new RegExp(
  `^\\.(?:.+\\.${UUID}\\.tmp|new-${UUID}|migrate-${UUID}-.+|claim-.+-\\d+)$`,
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
