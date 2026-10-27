import { Effect, FileSystem, Option, Path, PlatformError, Scope } from "effect";
import { tempName, writeFileAtomic } from "./files.ts";
import { TASK_FILE } from "./layout.ts";
import { frontmatterId, patchFrontmatter } from "./markdown.ts";

/** The file in a task folder naming the id being written into its `task.md`. */
const PENDING_ID = ".pending-id";

const alreadyExists = (error: PlatformError.PlatformError) => error.reason._tag === "AlreadyExists";

/**
 * Reserves `count` new task ids from `floor` up until the scope closes, against every process on
 * this machine: each id is a claim file created exclusively, then checked against `nextOnDisk` read
 * after the claim, which sees every task created before it. Devices that sync `.octodo/` (iCloud,
 * git) do not see each other's claims; their clashes stay a duplicate-id diagnostic.
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
            .writeFileString(claim(`${key}-${number}`), "", { flag: "wx" })
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
 * The id a task folder without one is getting from another process, read before its `task.md` so
 * that a missing marker means the id, if any, is already in the file.
 */
export const pendingId = (
  dir: string,
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = yield* Effect.option(fs.readFileString(path.join(dir, PENDING_ID)));
    if (Option.isSome(marker)) return marker.value.trim();
    return frontmatterId(yield* fs.readFileString(path.join(dir, TASK_FILE)));
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * Writes `candidate` into the task folder's `task.md` unless another process is already giving it
 * an id, in which case it writes that one: the first `.pending-id` marker decides, so concurrent
 * readers of one new file agree on its id, and a marker a crash left behind is finished here.
 */
export const giveId = (
  dir: string,
  candidate: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = path.join(dir, PENDING_ID);
    const temp = path.join(dir, tempName.file(PENDING_ID));
    yield* fs.writeFileString(temp, `${candidate}\n`);
    const won = yield* fs.link(temp, marker).pipe(
      Effect.as(true),
      Effect.catchIf(alreadyExists, () => Effect.succeed(false)),
      Effect.ensuring(Effect.ignore(fs.remove(temp))),
    );
    // The marker goes only once task.md holds an id, so one gone by now means the file has it.
    const pending = won ? Option.some(candidate) : yield* Effect.option(fs.readFileString(marker));
    const file = path.join(dir, TASK_FILE);
    const text = yield* fs.readFileString(file);
    const written = frontmatterId(text);
    const id = written ?? Option.getOrThrow(pending).trim();
    if (written === null) yield* writeFileAtomic(file, patchFrontmatter(text, { id }));
    yield* Effect.ignore(fs.remove(marker));
    return id;
  });
