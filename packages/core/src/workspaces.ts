import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  InvalidRequest,
  StorageError,
  WorkspaceConfig,
  WorkspaceNotFound,
  type FolderListing,
  type WorkspaceInfo,
} from "./domain.ts";
import { CONFIG_FILE, TASKS_DIR, slugify } from "./layout.ts";
import { initWorkspace, makeWorkspace, type Workspace } from "./workspace.ts";

const RegistryEntry = Schema.Struct({ id: Schema.String, root: Schema.String });
const Registry = Schema.Struct({ workspaces: Schema.Array(RegistryEntry) });
type Registry = typeof Registry.Type;

const decodeRegistry = Schema.decodeUnknownEffect(Schema.fromJsonString(Registry));
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkspaceConfig));

export interface WorkspaceChange {
  readonly workspace: string;
}

/**
 * The workspaces this machine knows about, kept in `<home>/workspaces.json` (like Obsidian's vault
 * list), and the open handle for each.
 */
export class Workspaces extends Context.Service<
  Workspaces,
  {
    readonly home: string;
    readonly list: Effect.Effect<ReadonlyArray<WorkspaceInfo>, StorageError>;
    readonly add: (
      root: string,
      options?: { readonly name?: string | undefined; readonly key?: string | undefined },
    ) => Effect.Effect<WorkspaceInfo, StorageError>;
    readonly remove: (id: string) => Effect.Effect<void, WorkspaceNotFound | StorageError>;
    readonly get: (id: string) => Effect.Effect<Workspace, WorkspaceNotFound | StorageError>;
    /**
     * `target` as a folder when it starts with `/` or `.` (the nearest ancestor holding a `.octodo/`
     * folder), otherwise as a registered id.
     */
    readonly open: (target: string) => Effect.Effect<Workspace, WorkspaceNotFound | StorageError>;
    /**
     * The folders inside `dir` (an absolute path), skipping hidden ones, so a client without a
     * native folder picker (a browser, a phone) can choose a workspace folder on this machine.
     */
    readonly browse: (dir: string) => Effect.Effect<FolderListing, InvalidRequest | StorageError>;
    readonly changes: Stream.Stream<WorkspaceChange>;
  }
>()("@octodo/core/Workspaces") {
  static readonly layer = (options: { readonly home: string; readonly watch: boolean }) =>
    Layer.effect(
      Workspaces,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const scope = yield* Scope.Scope;
        const registryFile = path.join(options.home, "workspaces.json");
        const lock = yield* Semaphore.make(1);
        const handles = new Map<string, Workspace>();
        const changes = yield* PubSub.sliding<WorkspaceChange>(64);

        const withPlatform = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );

        const fail = (message: string) => (cause: unknown) => new StorageError({ message, cause });

        const readRegistry = Effect.gen(function* () {
          if (!(yield* fs.exists(registryFile))) return { workspaces: [] } satisfies Registry;
          return yield* decodeRegistry(yield* fs.readFileString(registryFile));
        }).pipe(Effect.mapError(fail(`Could not read ${registryFile}`)));

        const writeRegistry = (registry: Registry) =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(options.home, { recursive: true });
            yield* fs.writeFileString(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
          }).pipe(Effect.mapError(fail(`Could not write ${registryFile}`)));

        const info = (entry: { id: string; root: string }) =>
          Effect.gen(function* () {
            const text = yield* fs.readFileString(path.join(entry.root, TASKS_DIR, CONFIG_FILE));
            const config = yield* decodeConfig(text);
            return {
              id: entry.id,
              root: entry.root,
              name: config.name,
              key: config.key,
            } satisfies WorkspaceInfo;
          }).pipe(Effect.mapError(fail(`Could not read the workspace at ${entry.root}`)));

        const openHandle = (id: string, root: string) =>
          Effect.gen(function* () {
            const existing = handles.get(id);
            if (existing !== undefined) return existing;
            const workspace = yield* makeWorkspace(id, root, { watch: options.watch }).pipe(
              Scope.provide(scope),
              withPlatform,
            );
            handles.set(id, workspace);
            yield* workspace.changes.pipe(
              Stream.runForEach(() => PubSub.publish(changes, { workspace: id })),
              Effect.forkIn(scope),
            );
            return workspace;
          });

        const list = Effect.gen(function* () {
          const registry = yield* readRegistry;
          return yield* Effect.forEach(registry.workspaces, info);
        });

        const add = Effect.fnUntraced(function* (
          root: string,
          init: { readonly name?: string | undefined; readonly key?: string | undefined } = {},
        ) {
          const absolute = path.resolve(root);
          yield* withPlatform(initWorkspace(absolute, init));
          return yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const registry = yield* readRegistry;
              const known = registry.workspaces.find((entry) => entry.root === absolute);
              if (known !== undefined) return yield* info(known);
              const base = slugify(path.basename(absolute)) || "workspace";
              let id = base;
              for (let n = 2; registry.workspaces.some((entry) => entry.id === id); n++)
                id = `${base}-${n}`;
              yield* writeRegistry({
                workspaces: [...registry.workspaces, { id, root: absolute }],
              });
              return yield* info({ id, root: absolute });
            }),
          );
        });

        const remove = (id: string) =>
          lock.withPermits(1)(
            Effect.gen(function* () {
              const registry = yield* readRegistry;
              if (!registry.workspaces.some((entry) => entry.id === id))
                return yield* new WorkspaceNotFound({ workspace: id });
              yield* writeRegistry({
                workspaces: registry.workspaces.filter((entry) => entry.id !== id),
              });
            }),
          );

        const get = (id: string) =>
          Effect.gen(function* () {
            const entry = (yield* readRegistry).workspaces.find((candidate) => candidate.id === id);
            if (entry === undefined) return yield* new WorkspaceNotFound({ workspace: id });
            return yield* openHandle(entry.id, entry.root);
          });

        const containing = (dir: string) =>
          Effect.gen(function* () {
            let current = path.resolve(dir);
            while (true) {
              const found = yield* fs
                .exists(path.join(current, TASKS_DIR, CONFIG_FILE))
                .pipe(Effect.mapError(fail(`Could not read ${current}`)));
              if (found) {
                const registered = (yield* readRegistry).workspaces.find(
                  (entry) => entry.root === current,
                );
                return yield* openHandle(
                  registered?.id ?? slugify(path.basename(current)),
                  current,
                );
              }
              const parent = path.dirname(current);
              if (parent === current) return yield* new WorkspaceNotFound({ workspace: dir });
              current = parent;
            }
          });

        const open = (target: string) =>
          target.startsWith("/") || target.startsWith(".") ? containing(target) : get(target);

        const hasWorkspace = (dir: string) =>
          fs.exists(path.join(dir, TASKS_DIR, CONFIG_FILE)).pipe(Effect.orElseSucceed(() => false));

        const browse = (dir: string) =>
          Effect.gen(function* () {
            if (!path.isAbsolute(dir))
              return yield* new InvalidRequest({ message: "Use an absolute folder path" });
            const current = path.resolve(dir);
            const info = yield* fs
              .stat(current)
              .pipe(
                Effect.mapError(() => new InvalidRequest({ message: `No folder at ${current}` })),
              );
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

        return Workspaces.of({
          home: options.home,
          list,
          add,
          remove,
          get,
          open,
          browse,
          changes: Stream.fromPubSub(changes),
        });
      }),
    );
}

/** `$OCTODO_HOME`, or `~/.config/octodo`. */
export const defaultHome = (env: NodeJS.ProcessEnv, homedir: string): string =>
  env["OCTODO_HOME"] ?? `${env["XDG_CONFIG_HOME"] ?? `${homedir}/.config`}/octodo`;
