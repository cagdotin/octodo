import type {
  FixResult,
  InvalidRequest,
  PluginNotEnabled,
  ServerMismatch,
  ServerUnavailable,
  StorageError,
  WorkspaceInfo,
  WorkspaceNotFound,
} from "@octodo/contract";
import type { Operation, OperationName } from "@octodo/contract/catalog";
import type { OperationError } from "@octodo/engine";
import type { Effect } from "effect";

/** Every way a call through a connection can fail, in either mode. */
export type ClientError =
  | OperationError<OperationName>
  | PluginNotEnabled
  | WorkspaceNotFound
  | InvalidRequest
  | StorageError
  | ServerMismatch
  | ServerUnavailable;

export interface WorkspaceOptions {
  readonly name?: string | undefined;
  readonly key?: string | undefined;
}

/** Where calls run: the server over HTTP, or the engine in this process. Both give the same. */
export interface Backend {
  /** Runs an operation on its decoded input, whose `workspace` is an id or an absolute folder. */
  readonly run: (
    name: string,
    operation: Operation,
    input: Record<string, unknown>,
  ) => Effect.Effect<unknown, ClientError>;
  readonly addWorkspace: (
    root: string,
    options: WorkspaceOptions,
  ) => Effect.Effect<WorkspaceInfo, ClientError>;
  readonly removeWorkspace: (id: string) => Effect.Effect<void, ClientError>;
  readonly fixAll: (workspace: string) => Effect.Effect<FixResult, ClientError>;
}
