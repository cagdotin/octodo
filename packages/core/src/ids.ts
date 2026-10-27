import { Effect, FileSystem, Option, Path, PlatformError, Scope } from "effect";
import { claimOwner, tempName, writeFileAtomic } from "./files.ts";
import { TASK_FILE, idNumber, isTaskId } from "./layout.ts";
import { frontmatterId, needsId, patchFrontmatter } from "./markdown.ts";

const alreadyExists = (error: PlatformError.PlatformError) => error.reason._tag === "AlreadyExists";

/**
 * Reserves `count` new task ids from `floor` up until the scope closes, against every process on
 * this machine: each id is a claim file created exclusively, naming its owner, then checked
 * against `nextOnDisk` read after the claim, which sees every task created before it. Devices that
 * sync `.octodo/` (iCloud, git) do not see each other's claims; their clashes stay a duplicate-id
 * diagnostic.
 */
export const claimIds = <R>(
  tasksDir: string,
  key: string,
  floor: number,
  count: number,
  nextOnDisk: Effect.Effect<number, never, R>,
): Effect.Effect<
  ReadonlyArray<string>,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | Scope.Scope | R
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const claim = (id: string) => path.join(tasksDir, tempName.claim(id));
    const release = (numbers: ReadonlyArray<number>) =>
      Effect.forEach(numbers, (number) => Effect.ignore(fs.remove(claim(`${key}-${number}`))), {
        discard: true,
      });
    /** The first `count` numbers from `start` this process could claim, in ascending order. */
    const claimFrom = (start: number) =>
      Effect.gen(function* () {
        const numbers: Array<number> = [];
        for (let number = start; numbers.length < count; number++) {
          const created = yield* fs
            .writeFileString(claim(`${key}-${number}`), claimOwner(), { flag: "wx" })
            .pipe(
              Effect.as(true),
              Effect.catchIf(alreadyExists, () => Effect.succeed(false)),
              Effect.onError(() => release(numbers)),
            );
          if (created) numbers.push(number);
        }
        return numbers;
      });
    const acquire = Effect.gen(function* () {
      let start = floor;
      for (;;) {
        const numbers = yield* claimFrom(start);
        const next = yield* nextOnDisk;
        if (numbers.length === 0 || numbers[0]! >= next) return numbers;
        yield* release(numbers);
        start = next;
      }
    });
    const numbers = yield* Effect.acquireRelease(acquire, release);
    return numbers.map((number) => `${key}-${number}`);
  });

/**
 * The number past every id with workspace key `key` in a markdown file or `.pending-id` marker
 * under `tasksDir`, as a scan's `nextIdNumber`, but from each file's id line alone. A task moved
 * between folders while this walks can be missed; a create checks its id after the write.
 */
export const nextIdOnDisk = (
  tasksDir: string,
  key: string,
): Effect.Effect<number, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    let highest = 0;
    const take = (file: string) =>
      Effect.map(fs.readFileString(file), (text) => {
        const id = file.endsWith(".md") ? frontmatterId(text) : text.trim();
        highest = Math.max(highest, (id === null ? null : idNumber(id, key)) ?? 0);
      });
    const walk = (dir: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const names = yield* fs.readDirectory(dir);
        yield* Effect.forEach(
          names,
          (name) => {
            const child = path.join(dir, name);
            if (name === tempName.pendingId) return take(child);
            if (name.startsWith(".")) return Effect.void;
            if (name.endsWith(".md")) return take(child);
            return Effect.flatMap(fs.stat(child), (info) =>
              info.type === "Directory" ? walk(child) : Effect.void,
            );
          },
          { concurrency: 16, discard: true },
        );
      }).pipe(Effect.ignore);
    yield* walk(tasksDir);
    return highest + 1;
  });

/**
 * The id a task folder without one is getting from another process, read before its `task.md` so
 * that a missing marker means the id, if any, is already in the file.
 */
export const pendingId = (
  dir: string,
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = yield* Effect.option(fs.readFileString(path.join(dir, tempName.pendingId)));
    if (Option.isSome(marker)) return marker.value.trim();
    return frontmatterId(yield* fs.readFileString(path.join(dir, TASK_FILE)));
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * Writes `candidate` into the task folder's `task.md` unless another process is already giving it
 * an id, in which case it writes that one: the first `.pending-id` marker decides, so concurrent
 * readers of one new file agree on its id, and a marker a crash left behind is finished here.
 * A marker naming an id that is `taken` came with a copied folder and is dropped. Returns the id
 * written, or null when the file needs none by now.
 */
export const giveId = (
  dir: string,
  candidate: string,
  taken: (id: string) => boolean,
): Effect.Effect<
  string | null,
  PlatformError.PlatformError | Error,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = path.join(dir, tempName.pendingId);
    const file = path.join(dir, TASK_FILE);
    /** The id the marker names, after placing ours if there was none; none if it is unreadable. */
    const markedId = Effect.gen(function* () {
      const temp = path.join(dir, tempName.file(tempName.pendingId));
      yield* fs.writeFileString(temp, `${candidate}\n`);
      const won = yield* fs.link(temp, marker).pipe(
        Effect.as(true),
        Effect.catchIf(alreadyExists, () => Effect.succeed(false)),
        Effect.ensuring(Effect.ignore(fs.remove(temp))),
      );
      if (won) return Option.some(candidate);
      return Option.map(yield* Effect.option(fs.readFileString(marker)), (id) => id.trim());
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = yield* markedId;
      const text = yield* fs.readFileString(file);
      if (!needsId(text)) {
        yield* Effect.ignore(fs.remove(marker));
        return null;
      }
      // A marker gone between the link and the read was a crash's, taken by removeLeftovers.
      if (Option.isNone(id)) continue;
      if (!isTaskId(id.value) || taken(id.value)) {
        yield* fs.remove(marker);
        continue;
      }
      yield* writeFileAtomic(file, patchFrontmatter(text, { id: id.value }));
      yield* Effect.ignore(fs.remove(marker));
      return id.value;
    }
    return yield* Effect.fail(new Error(`${tempName.pendingId} is there but cannot be read`));
  });
