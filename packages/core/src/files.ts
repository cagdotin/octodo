import { Effect, FileSystem, Path, PlatformError } from "effect";

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

/** Writes through a temporary sibling and a rename, so a crash or a reader never sees half a file. */
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
