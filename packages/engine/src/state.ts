import { Duration, Effect, Scope, Semaphore } from "effect";
import { join, relative } from "node:path";
import { TASK_FILE } from "./layout.ts";
import { InvalidRequest, StorageError } from "@octodo/contract";
import { patchFrontmatter } from "./frontmatter.ts";
import { fileText, scanWorkspace, type Scan } from "./scan.ts";
import type { Files } from "./storage/files.ts";
import {
  makeStorage,
  type AssignedId,
  type Ids,
  type Platform,
  type Storage,
} from "./storage/storage.ts";
import { needsId } from "./tasks/task-file.ts";
import type { Plugin } from "./plugins/plugin.ts";

/** One open workspace as its operations see it. */
export interface State {
  readonly storage: Storage;
  /** The plugins octodo has, whether this workspace enables them or not. */
  readonly plugins: ReadonlyArray<Plugin>;
  /**
   * The last scan, until a file changes. Files made by hand get an id the first time it reads
   * them. Use it inside `read` or `write`, which take turns over it.
   */
  readonly scan: Effect.Effect<Scan>;
  readonly read: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  /** Runs `change` holding the owner lock, taking turns with this process's reads. */
  readonly write: <A, E>(
    change: (files: Files, ids: Ids) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | StorageError>;
}

export const invalid = (message: string) => Effect.fail(new InvalidRequest({ message }));

export const storageError =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, StorageError, R> =>
    Effect.mapError(effect, (cause) => new StorageError({ message, cause }));

export const readBack = storageError("Could not read the workspace back after writing it");

export const nextId = (ids: Ids, { nextIdNumber, snapshot }: Scan): AssignedId =>
  ids.next(snapshot.workspace.key, nextIdNumber);

/** Gives each task file without an id the next id. */
const giveIds = (files: Files, ids: Ids, scan: Scan) =>
  Effect.forEach(scan.missingId, (dir) => {
    const file = join(dir, TASK_FILE);
    const shown = relative(scan.snapshot.workspace.root, file);
    const taskId = nextId(ids, scan);
    return Effect.gen(function* () {
      const text = yield* fileText(scan, file);
      if (!needsId(text)) return;
      yield* files.writeFile(file, patchFrontmatter(text, { id: taskId }));
      yield* Effect.logInfo(`Assigned ${taskId} to ${shown}`);
    }).pipe(Effect.catch((error) => Effect.logWarning(`Could not give ${shown} an id`, error)));
  });

export const makeState = (
  id: string,
  root: string,
  options: {
    readonly watch?: boolean;
    readonly lockWait?: Duration.Input;
    readonly plugins?: ReadonlyArray<Plugin>;
  },
): Effect.Effect<State, never, Platform | Scope.Scope> =>
  Effect.gen(function* () {
    const plugins = options.plugins ?? [];
    const storage = yield* makeStorage(root, {
      ...options,
      owned: [...new Set(plugins.flatMap((plugin) => plugin.shared.files))],
    });
    const lock = yield* Semaphore.make(1);
    const scanned = Effect.map(storage.read, (read) => scanWorkspace(id, root, read, plugins));

    let kept: { readonly version: number; readonly scan: Scan } | undefined;
    const scan = Effect.gen(function* () {
      if (kept?.version === storage.version()) return kept.scan;
      let version = storage.version();
      let current = yield* scanned;
      if (current.missingId.length > 0) {
        yield* storage
          .write((files, ids) => Effect.flatMap(scanned, (fresh) => giveIds(files, ids, fresh)))
          .pipe(Effect.catch((error) => Effect.logWarning(error.message)));
        version = storage.version();
        current = yield* scanned;
      }
      kept = { version, scan: current };
      return current;
    });

    return {
      storage,
      plugins,
      scan,
      read: lock.withPermits(1),
      write: (change) => lock.withPermits(1)(storage.write(change)),
    } satisfies State;
  });
