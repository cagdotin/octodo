import { Effect, FileSystem, Option, Path, PlatformError } from "effect";
import { OWNER_LOCK_FILE } from "./storage/owner-lock.ts";

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

/** The name a sync tool's conflict copy of a temporary name copies: `.new-<uuid> 2` copies `.new-<uuid>`. */
const copied = (name: string) => name.replace(/ \d+(?=(?:\.tmp)?$)/, "");

/** Whether `name` is one of octodo's own bookkeeping files, or a sync tool's copy of one. */
const isBookkeeping = (name: string) => LEFTOVER.test(copied(name));

/** Patterns in `.octodo/.gitignore` matching every bookkeeping name and its conflict copies. */
const IGNORED = [`${OWNER_LOCK_FILE}*`, ".new-*", ".*.tmp"];

/** Adds the bookkeeping patterns `.octodo/.gitignore` lacks, keeping the lines it has. */
export const ignoreBookkeeping = (
  tasksDir: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(tasksDir, ".gitignore");
    const text = (yield* Effect.option(fs.readFileString(file))).pipe(Option.getOrElse(() => ""));
    const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
    const missing = IGNORED.filter((pattern) => !lines.has(pattern));
    if (missing.length === 0) return;
    const kept = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
    yield* writeFileAtomic(file, `${kept}${missing.join("\n")}\n`);
  });

/**
 * Removes the temporary files and folders under `dir` that a crashed write left. Run it only
 * holding the owner lock: then no write that owns one is still running.
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
        if (isBookkeeping(name)) return yield* fs.remove(child, { recursive: true });
        const info = yield* fs.lstat(child);
        if (!name.startsWith(".") && info.type === "Directory") yield* removeLeftovers(child);
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

/**
 * Whether two folders hold the same names and bytes all the way down, hidden files included and
 * octodo's bookkeeping aside. A link is the same only as a link to the same place.
 */
export const sameTree = (
  a: string,
  b: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const [infoA, infoB] = [yield* fs.lstat(a), yield* fs.lstat(b)];
    if (infoA.type !== infoB.type) return false;
    if (infoA.type === "SymbolicLink") return (yield* fs.readLink(a)) === (yield* fs.readLink(b));
    if (infoA.type === "File") {
      const [bytesA, bytesB] = [yield* fs.readFile(a), yield* fs.readFile(b)];
      return bytesA.length === bytesB.length && bytesA.every((byte, i) => byte === bytesB[i]);
    }
    const kept = (names: ReadonlyArray<string>) =>
      names.filter((name) => !isBookkeeping(name)).toSorted();
    const [namesA, namesB] = [kept(yield* fs.readDirectory(a)), kept(yield* fs.readDirectory(b))];
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
