import { Context, Effect, Layer, Path, PubSub, Scope, Semaphore, Stream } from "effect";
import {
  InvalidRequest,
  StorageError,
  WorkspaceNotFound,
  type FolderListing,
  type WorkspaceChange,
  type WorkspaceInfo,
} from "@octodo/contract";
import { slugify } from "@octodo/contract/rules";
import { hasConfig, readConfig } from "./storage/config.ts";
import {
  browseFolders,
  readRegistry as readRegistryIn,
  realFolder,
  writeRegistry,
} from "./storage/home.ts";
import { checkPlugins, type Plugin } from "./plugins/plugin.ts";
import type { Platform } from "./storage/storage.ts";
import { initWorkspace, makeWorkspace, type Workspace } from "./workspace.ts";

/**
 * The workspaces this machine knows about, kept in `<home>/workspaces.json` (like Obsidian's vault
 * list), and the open handle for each.
 */
export class Workspaces extends Context.Service<
  Workspaces,
  {
    readonly home: string;
    /** The plugins octodo has, whose operations every surface offers. */
    readonly plugins: ReadonlyArray<Plugin>;
    readonly list: Effect.Effect<ReadonlyArray<WorkspaceInfo>, StorageError>;
    readonly add: (
      root: string,
      options?: { readonly name?: string | undefined; readonly key?: string | undefined },
    ) => Effect.Effect<WorkspaceInfo, InvalidRequest | StorageError>;
    readonly remove: (id: string) => Effect.Effect<void, WorkspaceNotFound | StorageError>;
    readonly get: (id: string) => Effect.Effect<Workspace, WorkspaceNotFound | StorageError>;
    /**
     * `target` as a folder when it starts with `/` or `.` (the nearest ancestor holding a
     * `.octodo/config.json`), otherwise as a registered id.
     */
    readonly open: (target: string) => Effect.Effect<Workspace, WorkspaceNotFound | StorageError>;
    /**
     * The folders inside `dir` (an absolute path), skipping hidden ones, so a client without a
     * native folder picker (a browser, a phone) can choose a workspace folder on this machine.
     */
    readonly browse: (dir: string) => Effect.Effect<FolderListing, InvalidRequest | StorageError>;
    readonly changes: Stream.Stream<WorkspaceChange>;
  }
>()("@octodo/engine/Workspaces") {
  /** `plugins` are the plugins octodo has; a set that cannot all be installed throws. */
  static readonly layer = (options: {
    readonly home: string;
    readonly watch: boolean;
    readonly plugins?: ReadonlyArray<Plugin>;
  }) =>
    Layer.effect(
      Workspaces,
      Effect.gen(function* () {
        const plugins = options.plugins ?? [];
        checkPlugins(plugins);
        const path = yield* Path.Path;
        const scope = yield* Scope.Scope;
        const platform = yield* Effect.context<Platform>();
        const lock = yield* Semaphore.make(1);
        /** By real folder: two unregistered folders can share an id, and one folder can have two paths. */
        const handles = new Map<string, Workspace>();
        const changes = yield* PubSub.sliding<WorkspaceChange>(64);

        const withPlatform = <A, E>(effect: Effect.Effect<A, E, Platform>) =>
          Effect.provideContext(effect, platform);

        const fail = (message: string) => (cause: unknown) => new StorageError({ message, cause });

        const readRegistry = withPlatform(readRegistryIn(options.home));

        const info = (entry: { id: string; root: string }) =>
          Effect.map(withPlatform(readConfig(entry.root)), ({ config }): WorkspaceInfo => ({
            id: entry.id,
            root: entry.root,
            name: config.name,
            key: config.key,
          }));

        const openHandle = (id: string, root: string) =>
          Effect.gen(function* () {
            const folder = yield* withPlatform(realFolder(root));
            const existing = handles.get(folder);
            if (existing !== undefined) return existing;
            const workspace = yield* makeWorkspace(id, root, {
              watch: options.watch,
              plugins,
            }).pipe(Scope.provide(scope), withPlatform);
            handles.set(folder, workspace);
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
              yield* withPlatform(
                writeRegistry(options.home, {
                  workspaces: [...registry.workspaces, { id, root: absolute }],
                }),
              );
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
              yield* withPlatform(
                writeRegistry(options.home, {
                  workspaces: registry.workspaces.filter((entry) => entry.id !== id),
                }),
              );
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
              const found = yield* withPlatform(hasConfig(current)).pipe(
                Effect.mapError(fail(`Could not read ${current}`)),
              );
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

        const browse = (dir: string) => withPlatform(browseFolders(dir));

        return Workspaces.of({
          home: options.home,
          plugins,
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
