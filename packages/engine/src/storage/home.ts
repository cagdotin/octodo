import { Effect, FileSystem, Path, Schema } from "effect";
import { InvalidRequest, StorageError, type FolderListing } from "@octodo/contract";
import { hasConfig } from "./config.ts";
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

/** Writes `<home>/workspaces.json`, creating `<home>` if need be. */
export const writeRegistry = (
  home: string,
  registry: Registry,
): Effect.Effect<void, StorageError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = registryFile(yield* Path.Path, home);
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(home, { recursive: true });
      yield* fs.writeFileString(file, `${JSON.stringify(registry, null, 2)}\n`);
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
