import { Effect, FileSystem, Path, PlatformError } from "effect";

/** Writes through a temporary sibling and a rename, so readers and sync tools never see half a file. */
export const writeFileAtomic = Effect.fnUntraced(function* (
  file: string,
  content: string | Uint8Array,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  if (typeof content === "string") yield* fs.writeFileString(temp, content);
  else yield* fs.writeFile(temp, content);
  yield* fs.rename(temp, file);
});

/** Whether a file system call failed because its path is gone, as when another process moved it. */
export const isNotFound = (error: unknown): boolean =>
  PlatformError.isPlatformError(error) && error.reason._tag === "NotFound";
