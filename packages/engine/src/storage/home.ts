import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { InvalidRequest, ServerInfo, StorageError, type FolderListing } from "@octodo/contract";
import { hasConfig } from "./config.ts";
import { isNotFound, writeFileAtomic } from "./files.ts";
import type { Platform } from "./storage.ts";

const RegistryEntry = Schema.Struct({ id: Schema.String, root: Schema.String });
const Registry = Schema.Struct({ workspaces: Schema.Array(RegistryEntry) });
export type Registry = typeof Registry.Type;

const decodeRegistry = Schema.decodeUnknownEffect(Schema.fromJsonString(Registry));

const fail = (message: string) => (cause: unknown) => new StorageError({ message, cause });

const registryFile = (path: Path.Path, home: string) => path.join(home, "workspaces.json");

/** The workspaces `<home>/workspaces.json` lists; none before it exists. */
export const readRegistry = (home: string): Effect.Effect<Registry, StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = registryFile(yield* Path.Path, home);
    return yield* Effect.gen(function* () {
      if (!(yield* fs.exists(file))) return { workspaces: [] } satisfies Registry;
      return yield* decodeRegistry(yield* fs.readFileString(file));
    }).pipe(Effect.mapError(fail(`Could not read ${file}`)));
  });

/** Writes `<home>/workspaces.json` whole, creating `<home>` if need be. */
export const writeRegistry = (
  home: string,
  registry: Registry,
): Effect.Effect<void, StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = registryFile(path, home);
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(home, { recursive: true });
      yield* writeFileAtomic(fs, path, file, `${JSON.stringify(registry, null, 2)}\n`);
    }).pipe(Effect.mapError(fail(`Could not write ${file}`)));
  });

/**
 * The folders inside `dir` (an absolute path), skipping hidden ones, so a client without a native
 * folder picker (a browser, a phone) can choose a workspace folder on this machine.
 */
export const browseFolders = (
  dir: string,
): Effect.Effect<FolderListing, InvalidRequest | StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hasWorkspace = (at: string) => hasConfig(at).pipe(Effect.orElseSucceed(() => false));
    if (!path.isAbsolute(dir))
      return yield* new InvalidRequest({ message: "Use an absolute folder path" });
    const current = path.resolve(dir);
    const info = yield* fs
      .stat(current)
      .pipe(Effect.mapError(() => new InvalidRequest({ message: `No folder at ${current}` })));
    if (info.type !== "Directory")
      return yield* new InvalidRequest({ message: `${current} is not a folder` });
    const names = yield* fs
      .readDirectory(current)
      .pipe(Effect.mapError(fail(`Could not read ${current}`)));
    const folders: Array<FolderListing["folders"][number]> = [];
    for (const name of names.toSorted((a, b) => a.localeCompare(b))) {
      if (name.startsWith(".")) continue;
      const child = path.join(current, name);
      // Unreadable entries and broken links are simply left out.
      const entry = yield* fs.stat(child).pipe(Effect.option);
      if (entry._tag === "None" || entry.value.type !== "Directory") continue;
      folders.push({ name, path: child, workspace: yield* hasWorkspace(child) });
    }
    const parent = path.dirname(current);
    return {
      path: current,
      parent: parent === current ? null : parent,
      workspace: yield* hasWorkspace(current),
      folders,
    } satisfies FolderListing;
  });

/** `dir` with its links resolved, so two spellings of one folder name it once; `dir` if unreadable. */
export const realFolder = (dir: string): Effect.Effect<string, never, Platform> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.realPath(dir).pipe(Effect.orElseSucceed(() => dir)),
  );

const serverFile = (path: Path.Path, home: string) => path.join(home, "server.json");

const decodeServerInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerInfo));

/** The server `<home>/server.json` names, or none when there is no file (decision 0018). */
export const readServerInfo = (
  home: string,
): Effect.Effect<Option.Option<ServerInfo>, StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = serverFile(yield* Path.Path, home);
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap(decodeServerInfo),
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeedNone),
      Effect.mapError(fail(`Could not read ${file}`)),
    );
  });

/** Writes `<home>/server.json` whole, creating `<home>` if need be. */
export const writeServerInfo = (
  home: string,
  info: ServerInfo,
): Effect.Effect<void, StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = serverFile(path, home);
    yield* fs
      .makeDirectory(home, { recursive: true })
      .pipe(
        Effect.andThen(writeFileAtomic(fs, path, file, `${JSON.stringify(info, null, 2)}\n`)),
        Effect.mapError(fail(`Could not write ${file}`)),
      );
  });

/** Removes `<home>/server.json` if it still names `info`, and not a server that started since. */
export const removeServerInfo = (
  home: string,
  info: ServerInfo,
): Effect.Effect<void, StorageError, Platform> =>
  Effect.gen(function* () {
    const named = yield* readServerInfo(home).pipe(Effect.orElseSucceed(Option.none));
    if (Option.isNone(named) || named.value.url !== info.url || named.value.pid !== info.pid)
      return;
    const fs = yield* FileSystem.FileSystem;
    const file = serverFile(yield* Path.Path, home);
    yield* fs.remove(file).pipe(
      Effect.catchIf(isNotFound, () => Effect.void),
      Effect.mapError(fail(`Could not remove ${file}`)),
    );
  });
