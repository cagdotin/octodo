import { Effect, FileSystem, Option, Path, PlatformError } from "effect";
import { hostname } from "node:os";

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

/** The name a sync tool's conflict copy of a bookkeeping file copies: `.claim-HM-5 2` copies `.claim-HM-5`. */
const copied = (name: string) => name.replace(/ \d+(?=(?:\.tmp)?$)/, "");

/** Patterns in `.octodo/.gitignore` matching every bookkeeping name and its conflict copies. */
const IGNORED = [".claim-*", ".pending-id*", ".new-*", ".migrate-*", ".*.tmp"];

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

/** How old a temporary file must be before it is taken as a crash's leftover, not a write in progress. */
const STALE_AFTER_MS = 60_000;

/** What a claim file holds: the process that owns it and its machine. */
export const claimOwner = (): string => `${process.pid} ${hostname()}\n`;

/** Whether a claim's owner still runs, or null when this machine cannot tell. */
const ownerRuns = (claim: string): boolean | null => {
  const match = /^(\d+) (.+)$/.exec(claim.trim());
  if (match === null || match[2] !== hostname()) return null;
  try {
    process.kill(Number(match[1]), 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
};

/**
 * Removes the temporary files and folders under `dir` that a crashed write or migration left: a
 * claim once its owner has stopped, anything else (and a claim from another machine) once it is
 * old enough that no live writer still owns it.
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
        if (LEFTOVER.test(copied(name))) {
          const runs = name.startsWith(".claim-")
            ? ownerRuns(yield* fs.readFileString(child).pipe(Effect.orElseSucceed(() => "")))
            : null;
          const modified = Option.getOrElse(info.mtime, () => new Date());
          const stale = Date.now() - modified.getTime() > STALE_AFTER_MS;
          if (runs === false || (runs === null && stale))
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
