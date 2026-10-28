import {
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  PlatformError,
  PubSub,
  Scope,
  Stream,
} from "effect";
import { OCTODO_DIR, TASKS_SECTION } from "../layout.ts";
import { StorageError, WorkspaceBusy, type WorkspaceConfig } from "@octodo/contract";
import { ignoreBookkeeping, isHidden, removeLeftovers } from "./bookkeeping.ts";
import { configFile, configText, readConfig, type ConfigRead } from "./config.ts";
import { makeFiles, type Files } from "./files.ts";
import { OWNER_LOCK_FILE, OwnerLockBusy, OwnerLockFailed, makeOwnerLock } from "./owner-lock.ts";
import { makeTreeReader, readAttachments, type AttachmentFile, type Tree } from "./tree.ts";

/** What storage runs on. Other modules only hand it on to `storage/`. */
export type Platform = FileSystem.FileSystem | Path.Path;

declare const assigned: unique symbol;

/** A task id the owner-lock holder handed out: the only kind a write puts into frontmatter. */
export type AssignedId = string & { readonly [assigned]: true };

/** Hands out task ids during a write, never one twice in a process. */
export interface Ids {
  /** The next id with `key`, numbered `atLeast` or past the last one handed out, if that is higher. */
  readonly next: (key: string, atLeast: number) => AssignedId;
}

/** What the files hold, read by the folder grammar and not yet parsed. */
export interface StorageRead {
  readonly config: ConfigRead;
  /** A file that has not changed since the last read keeps its text object. */
  readonly tree: Tree;
}

/** One workspace's files: the only way into `.octodo/`. */
export interface Storage {
  readonly root: string;
  /** Reads config.json and the tree, rereading only the paths that changed since the last read. */
  readonly read: Effect.Effect<StorageRead>;
  /** Counts the changes so far: what a caller made from a read holds while this stays the same. */
  readonly version: () => number;
  readonly forget: Effect.Effect<void>;
  /**
   * Forgets what was read once the watcher has stopped, so a long-lived process still sees what
   * others wrote. A process opened with `watch: false` runs one operation, so it keeps its cache.
   */
  readonly refresh: Effect.Effect<void>;
  readonly exists: (path: string) => Effect.Effect<boolean, PlatformError.PlatformError>;
  /**
   * The attachments in the task folder `dir`, as the folder grammar reads them, leaving out the
   * files `owned` names: the files of the task's plugin.
   */
  readonly attachments: (
    dir: string,
    owned?: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<AttachmentFile>, PlatformError.PlatformError>;
  readonly readBytes: (file: string) => Effect.Effect<Uint8Array, PlatformError.PlatformError>;
  /**
   * Whether the deepest existing part of `dir/segments` resolves, symlinks and all, to a place
   * inside `dir`, and the last segment is not a symlink.
   */
  readonly staysInside: (
    dir: string,
    segments: ReadonlyArray<string>,
  ) => Effect.Effect<boolean, PlatformError.PlatformError>;
  /**
   * Runs `change` as the only octodo process writing the workspace, holding the owner lock. Every
   * path it changes is forgotten as it changes; without a watcher, so is every other read.
   */
  readonly write: <A, E>(
    change: (files: Files, ids: Ids) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | StorageError | WorkspaceBusy>;
  /** Emits after files under `.octodo/` change, whoever changed them. Empty unless watching. */
  readonly changes: Stream.Stream<void>;
}

export const makeStorage = (
  root: string,
  options: {
    /** Whether a watcher reports what other processes change. */
    readonly watch?: boolean;
    /** How long a write waits for another process to release the owner lock. */
    readonly lockWait?: Duration.Input;
    /** The files plugins own at the top of a task or entry folder, which reads take in too. */
    readonly owned?: ReadonlyArray<string>;
    /** The marker file of each section a plugin adds, by the section's id. */
    readonly sections?: ReadonlyMap<string, string>;
  } = {},
): Effect.Effect<Storage, never, Platform | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(root, OCTODO_DIR);
    const reads = makeTreeReader({
      owned: options.owned ?? [],
      sections: options.sections ?? new Map(),
    });
    const files = makeFiles(fs, path, root, reads.changed);
    const changes = yield* PubSub.sliding<void>(16);
    let watching = options.watch === true;
    const withPlatform = <A, E>(effect: Effect.Effect<A, E, Platform>) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );

    const forget = Effect.sync(() => reads.clear());
    let watcherStopped = false;
    const refresh = Effect.suspend(() => (watcherStopped ? forget : Effect.void));

    /** Whether this process removed a crashed write's leftovers yet, which it does once. */
    let cleaned = false;
    const cleanUp = Effect.suspend(() => {
      if (cleaned) return Effect.void;
      cleaned = true;
      return withPlatform(
        Effect.andThen(removeLeftovers(dir), Effect.ignore(ignoreBookkeeping(dir))),
      );
    });

    const owner = yield* makeOwnerLock(path.join(dir, OWNER_LOCK_FILE), {
      wait: options.lockWait ?? "10 seconds",
      onNewHolder: Effect.andThen(forget, cleanUp),
    });

    let issued = 0;
    const ids: Ids = {
      next: (key, atLeast) => {
        issued = Math.max(issued + 1, atLeast);
        return `${key}-${issued}` as AssignedId;
      },
    };

    const write: Storage["write"] = (change) =>
      owner
        .hold(
          Effect.ensuring(
            Effect.suspend(() => change(files, ids)),
            Effect.suspend(() => (watching ? Effect.void : forget)),
          ),
        )
        .pipe(
          Effect.catchIf(
            (error) => error instanceof OwnerLockBusy || error instanceof OwnerLockFailed,
            (error) =>
              Effect.fail(
                error instanceof OwnerLockBusy
                  ? new WorkspaceBusy({ workspace: root })
                  : new StorageError({
                      message: `Could not take the workspace's owner lock (${OCTODO_DIR}/${OWNER_LOCK_FILE})`,
                      cause: error,
                    }),
              ),
          ),
        );

    const staysInside: Storage["staysInside"] = (dir, segments) =>
      Effect.gen(function* () {
        let deepest = dir;
        for (const [index, segment] of segments.entries()) {
          const next = path.join(deepest, segment);
          const info = yield* Effect.option(fs.lstat(next));
          if (Option.isNone(info)) break;
          if (info.value.type === "SymbolicLink" && index === segments.length - 1) return false;
          deepest = next;
        }
        const realDir = yield* fs.realPath(dir);
        const real = yield* Effect.option(fs.realPath(deepest));
        return (
          Option.isSome(real) &&
          (real.value === realDir || real.value.startsWith(`${realDir}${path.sep}`))
        );
      });

    if (watching) {
      yield* fs.watch(dir, { recursive: true }).pipe(
        Stream.map((event) => path.join(dir, event.path)),
        Stream.filter((changed) => !isHidden(path.basename(changed))),
        Stream.tap((changed) => Effect.sync(() => reads.changed(changed))),
        Stream.debounce("75 millis"),
        Stream.runForEach(() => PubSub.publish(changes, undefined)),
        Effect.catch((error) => Effect.logWarning(`Stopped watching ${dir}`, error)),
        Effect.ensuring(
          Effect.sync(() => {
            watching = false;
            watcherStopped = true;
            reads.clear();
          }),
        ),
        Effect.forkScoped,
      );
    }

    return {
      root,
      read: withPlatform(Effect.all({ config: readConfig(root), tree: reads.read(dir) })),
      version: reads.version,
      forget,
      refresh,
      exists: (at) => fs.exists(at),
      attachments: (dir, owned) => withPlatform(readAttachments(dir, owned)),
      readBytes: (file) => fs.readFile(file),
      staysInside,
      write,
      changes: Stream.fromPubSub(changes),
    } satisfies Storage;
  });

/**
 * Makes `root` a workspace: creates its `.octodo/` folder, with `root` itself if need be, then
 * writes config.json and makes `tasks/` holding the owner lock, whose first hold also writes
 * `.gitignore`.
 */
export const createWorkspace = (
  root: string,
  config: WorkspaceConfig,
): Effect.Effect<void, PlatformError.PlatformError | StorageError | WorkspaceBusy, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.join(root, OCTODO_DIR), { recursive: true });
    const storage = yield* makeStorage(root);
    yield* storage.write((files) =>
      Effect.andThen(
        files.writeFile(configFile(path, root), configText(config)),
        files.ensureFolder(path.join(root, OCTODO_DIR, TASKS_SECTION)),
      ),
    );
  }).pipe(Effect.scoped);
