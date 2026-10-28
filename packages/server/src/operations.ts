import type { AttachmentFile } from "@octodo/contract";
import { Api } from "@octodo/contract/api";
import type { OperationName } from "@octodo/contract/catalog";
import { runOperation, Workspaces, type OperationInput, type Workspace } from "@octodo/engine";
import { Effect, type FileSystem, type Layer, type Path } from "effect";
import type { HttpPlatform, HttpServerRequest } from "effect/http";
import { HttpApiBuilder, type HttpApiGroup } from "effect/http-api";
import { serveAttachment } from "./attachments.ts";

type FileLocator = (workspace: Workspace, input: never) => Effect.Effect<AttachmentFile, unknown>;

/**
 * Where the file of each operation whose success is a file is, without reading it: the download
 * streams it from disk instead of the bytes `runOperation` reads (decision 0011).
 */
const files: { readonly [K in OperationName]?: FileLocator } = {
  read_attachment: (ws, { id, path }: OperationInput<"read_attachment">) => ws.attachment(id, path),
};

interface Request {
  readonly params?: Record<string, string>;
  readonly query?: object;
  readonly payload?: object;
}

interface Handlers {
  readonly handle: (
    name: string,
    handler: (
      request: Request,
    ) => Effect.Effect<unknown, unknown, HttpServerRequest.HttpServerRequest>,
  ) => Handlers;
}

const isFile = (schema: unknown) =>
  (schema as { readonly _tag?: string })._tag === "StreamUint8Array";

const build = Effect.fnUntraced(function* (handlers: Handlers) {
  const workspaces = yield* Workspaces;
  const platform = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | HttpPlatform.HttpPlatform
  >();
  const open = (workspace: string | undefined) => workspaces.get(workspace!);
  for (const endpoint of Object.values(Api.groups.operations.endpoints)) {
    const name = endpoint.identifier as OperationName;
    const locate = files[name];
    if ([...endpoint.success].some(isFile) && locate === undefined)
      return yield* Effect.die(`The operation ${name} answers with a file that nothing locates`);
    handlers = handlers.handle(name, ({ params, query, payload }) => {
      const input = { ...query, ...payload, ...params };
      if (locate === undefined)
        return runOperation(name, input as never, open).pipe(
          Effect.provideService(Workspaces, workspaces),
        );
      const { workspace, ...rest } = input;
      return open(workspace).pipe(
        Effect.flatMap((ws) => locate(ws, rest as never)),
        Effect.flatMap((file) => Effect.provide(serveAttachment(file), platform)),
      );
    });
  }
  return handlers;
});

/**
 * Implements every endpoint of the `operations` group: an operation's input is its path
 * parameters, its query and its body together, and `runOperation` runs it in the workspace the
 * path names, which must be registered. The loop is untyped; `Api` types each endpoint.
 */
export const OperationsLive: Layer.Layer<
  HttpApiGroup.Service<"octodo", "operations">,
  never,
  Workspaces | FileSystem.FileSystem | Path.Path | HttpPlatform.HttpPlatform
> = HttpApiBuilder.group(Api, "operations", build as never);
