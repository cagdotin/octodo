import {
  InvalidRequest,
  ServerMismatch,
  ServerUnavailable,
  type FixResult,
  type ServerInfo,
} from "@octodo/contract";
import { VERSION } from "@octodo/contract/api";
import { inOneWorkspace, type Operation } from "@octodo/contract/catalog";
import { readServerInfo, Workspaces, type Registry } from "@octodo/engine";
import { Context, Effect, Layer, Option, type FileSystem, type Path, type Scope } from "effect";
import { resolve } from "node:path";
import type { Backend, ClientError } from "./backend.ts";
import { embeddedBackend } from "./embedded.ts";
import { remoteBackend } from "./remote.ts";

export interface ConnectOptions {
  /** The octodo home: `workspaces.json`, and `server.json` when a server runs. */
  readonly home: string;
  /** The operations this process offers, with its plugins. */
  readonly registry: Registry;
  /** Whether the embedded engine watches the files, for a process that runs for a while. */
  readonly watch: boolean;
}

/**
 * The operations and the workspace endpoints, run by the server `server.json` names when it
 * answers, and by the engine in this process when there is none (decision 0018). Every call picks
 * again, so a long-running process follows a server that starts or stops.
 */
export class Connection extends Context.Service<
  Connection,
  {
    /** Every operation of the registry: the catalog's and the plugins'. */
    readonly operations: Registry["operations"];
    /**
     * Runs an operation on its decoded input. A `workspace` that names a folder relative to the
     * current directory (`.`, `../x`) is made absolute first, since the server has its own.
     */
    readonly run: (name: string, input: object) => Effect.Effect<unknown, ClientError>;
    readonly removeWorkspace: (id: string) => Effect.Effect<void, ClientError>;
    readonly fixAll: (workspace: string) => Effect.Effect<FixResult, ClientError>;
  }
>()("@octodo/client/Connection") {
  static readonly layer = (options: ConnectOptions) => Layer.effect(Connection, connect(options));
}

/** How long a server named in `server.json` has to answer `/api/health`. */
const PROBE_TIMEOUT_MS = 2000;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Whether to use the server `info` names: yes when it answers as this version does, no when
 * nothing listens at its address any more, and an error when it is there but cannot be used.
 */
const usable = (info: ServerInfo): Effect.Effect<boolean, ServerMismatch | ServerUnavailable> =>
  Effect.gen(function* () {
    const unavailable = (reason: string) =>
      new ServerUnavailable({ url: info.url, reason: `(pid ${info.pid}) ${reason}` });
    const answer = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${info.url}/api/health`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      catch: (error) => error as Error & { readonly cause?: { readonly code?: string } },
    }).pipe(
      Effect.catch((error) =>
        error.cause?.code === "ECONNREFUSED"
          ? Effect.succeed(null)
          : Effect.fail(
              unavailable(
                error.name === "TimeoutError"
                  ? `does not answer within ${PROBE_TIMEOUT_MS / 1000} s. Stop it, or wait for it to answer.`
                  : `cannot be reached (${error.cause?.code ?? error.message}). Stop it, or start it again.`,
              ),
            ),
      ),
    );
    if (answer === null) return false;
    const body = answer.body as { readonly version?: unknown; readonly capabilities?: any } | null;
    if (answer.status !== 200 || typeof body?.version !== "string")
      return yield* unavailable(
        `answers /api/health with ${answer.status}, not as octodo does. Stop it, or free its port.`,
      );
    if (body.version !== VERSION)
      return yield* new ServerMismatch({ url: info.url, version: body.version, expected: VERSION });
    return body.capabilities?.operations === true;
  });

/** A folder relative to this process's directory, made absolute; an id or absolute path as is. */
const located = (workspace: unknown) =>
  typeof workspace === "string" && workspace.startsWith(".") ? resolve(workspace) : workspace;

/** A `Connection`; nothing is read until the first call. */
export const connect = (
  options: ConnectOptions,
): Effect.Effect<Connection["Service"], never, Scope.Scope | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const { registry } = options;

    const embedded = yield* Effect.cached(
      Layer.buildWithScope(
        Workspaces.layer({ home: options.home, watch: options.watch, plugins: registry.plugins }),
        scope,
      ).pipe(
        Effect.map((context) => embeddedBackend(Context.get(context, Workspaces), registry)),
        Effect.provideContext(platform),
      ),
    );

    let server: { readonly url: string; readonly pid: number; readonly backend: Backend } | null =
      null;

    const route: Effect.Effect<Backend, ClientError> = Effect.gen(function* () {
      const named = yield* readServerInfo(options.home).pipe(Effect.provideContext(platform));
      if (Option.isNone(named) || !isRunning(named.value.pid)) return yield* embedded;
      const { url, pid } = named.value;
      if (server?.url === url && server.pid === pid) return server.backend;
      if (!(yield* usable(named.value))) return yield* embedded;
      server = { url, pid, backend: remoteBackend(url) };
      return server.backend;
    });

    const run = (name: string, input: object) =>
      Effect.gen(function* () {
        const operation: Operation | undefined = registry.operations[name];
        if (operation === undefined) return yield* Effect.die(`No operation ${name}`);
        const { workspace, ...rest } = input as { readonly workspace?: unknown };
        if (inOneWorkspace(operation) && workspace === undefined)
          return yield* new InvalidRequest({
            message: "Pass a workspace: call list_workspaces to see them",
          });
        const backend = yield* route;
        return yield* backend.run(
          name,
          operation,
          workspace === undefined ? rest : { ...rest, workspace: located(workspace) },
        );
      });

    return Connection.of({
      operations: registry.operations,
      run,
      removeWorkspace: (id) => Effect.flatMap(route, (backend) => backend.removeWorkspace(id)),
      fixAll: (workspace) =>
        Effect.flatMap(route, (backend) => backend.fixAll(located(workspace) as string)),
    });
  });
