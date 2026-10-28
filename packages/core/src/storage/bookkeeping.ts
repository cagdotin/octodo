import { Effect, FileSystem, Option, Path, PlatformError } from "effect";
import { isLeftover, writeFileAtomic } from "./files.ts";
import { OWNER_LOCK_FILE } from "./owner-lock.ts";

/** Dot names are octodo's bookkeeping (the owner lock, temporary files), which scans never read. */
export const isHidden = (name: string): boolean => name.startsWith(".");

/** Patterns in `.octodo/.gitignore` matching every bookkeeping name. */
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
        if (isLeftover(name)) return yield* fs.remove(child, { recursive: true });
        const info = yield* fs.lstat(child);
        if (!isHidden(name) && info.type === "Directory") yield* removeLeftovers(child);
      }).pipe(Effect.ignore);
    }
  }).pipe(Effect.ignore);
