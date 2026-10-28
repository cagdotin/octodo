import {
  InvalidRequest,
  ServerUnavailable,
  StorageError,
  WorkspaceNotFound,
  wireErrorsOf,
  type AttachmentContent,
} from "@octodo/contract";
import { FileSuccess, pathParams, type Operation } from "@octodo/contract/catalog";
import { ApiError, createClient, type JsonRouteKey } from "@octodo/contract/client";
import { Effect, Schema } from "effect";
import { fileURLToPath } from "node:url";
import type { Backend, ClientError } from "./backend.ts";

/** Errors every route can answer with besides its own, as the server's middleware sends them. */
const COMMON_ERRORS = [InvalidRequest, WorkspaceNotFound, StorageError];

const errorCodecs = new WeakMap<Schema.Top, Schema.Codec<unknown, unknown>>();

/** An endpoint outside the catalog fails with the common errors only. */
const APP_ERRORS = Schema.Union(COMMON_ERRORS);

const errorCodec = (error: Schema.Top) => {
  let codec = errorCodecs.get(error);
  if (codec === undefined) {
    codec = Schema.Union([...wireErrorsOf(error), ...wireErrorsOf(APP_ERRORS)]) as never;
    errorCodecs.set(error, codec);
  }
  return codec;
};

/** What a failed fetch says about the server, for the person who has to deal with it. */
const unreachable = (url: string, cause: unknown) => {
  const code = (cause as { readonly cause?: { readonly code?: string } }).cause?.code;
  return new ServerUnavailable({
    url,
    reason: `closed the connection${code === undefined ? "" : ` (${code})`}. Try again, or stop it.`,
  });
};

/**
 * The server's error body as the tagged error the engine would have failed with, so a message
 * reads the same in both modes; a body octodo does not send is the server's fault.
 */
const decodeFailure = (url: string, error: Schema.Top, status: number, body: unknown) =>
  Schema.decodeUnknownEffect(errorCodec(error))(body).pipe(
    Effect.flatMap((decoded) => Effect.fail(decoded as ClientError)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        new ServerUnavailable({
          url,
          reason: `answered ${status} with ${JSON.stringify(body) ?? "no body"}, which octodo does not send. Restart it.`,
        }),
      ),
    ),
  );

/** Sends one request through the typed client, failing as the route's error schema says. */
const send = <A>(url: string, error: Schema.Top, call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      cause instanceof ApiError
        ? decodeFailure(url, error, cause.status, cause.body)
        : Effect.fail(unreachable(url, cause)),
    ),
  );

const decodeSuccess = (url: string, schema: Schema.Top, value: unknown) =>
  Schema.decodeUnknownEffect(
    Schema.toCodecJson(schema) as unknown as Schema.Codec<unknown, unknown>,
  )(value).pipe(
    Effect.mapError(
      (cause) =>
        new ServerUnavailable({
          url,
          reason: `answered with a result octodo cannot read (${cause.message}). Restart it.`,
        }),
    ),
  );

/** The operations and endpoints of the server at `url`, over its HTTP API. */
export const remoteBackend = (url: string): Backend => {
  const client = createClient(url);

  /** The request of an operation: its path parameters, then its query or its body. */
  const requestOf = (operation: Operation, input: Record<string, unknown>) => {
    const inPath = pathParams(operation.http);
    const params = Object.fromEntries(inPath.map((key) => [key, String(input[key])]));
    const rest = Object.fromEntries(Object.entries(input).filter(([key]) => !inPath.includes(key)));
    const part = operation.http.method === "GET" ? "query" : "payload";
    return {
      key: `${operation.http.method} /api${operation.http.path}` as JsonRouteKey,
      request: { params, ...(Object.keys(rest).length === 0 ? {} : { [part]: rest }) } as never,
    };
  };

  const readFile = (operation: Operation, input: Record<string, unknown>) => {
    const { key, request } = requestOf(operation, input);
    return send(url, operation.error, async (): Promise<AttachmentContent> => {
      const response = await fetch(client.url(key, request));
      if (!response.ok)
        throw new ApiError(response.status, await response.json().catch(() => undefined));
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        path: String(input["path"]),
        size: bytes.length,
        mediaType: response.headers.get("content-type") ?? "application/octet-stream",
        file: fileURLToPath(response.headers.get("content-location")!),
        bytes,
      };
    });
  };

  return {
    run: (_name, operation, input) =>
      Effect.gen(function* () {
        const encoded = (yield* Schema.encodeUnknownEffect(
          Schema.toCodecJson(operation.input) as unknown as Schema.Codec<unknown, unknown>,
        )(input).pipe(
          Effect.mapError((cause) => new InvalidRequest({ message: cause.message })),
        )) as Record<string, unknown>;
        if (operation.success === FileSuccess) return yield* readFile(operation, encoded);
        const { key, request } = requestOf(operation, encoded);
        const value = yield* send(url, operation.error, () => client.request(key, request));
        return yield* decodeSuccess(url, operation.success as Schema.Top, value);
      }),
    addWorkspace: (root, options) =>
      send(url, APP_ERRORS, () =>
        client.request("POST /api/workspaces", {
          payload: {
            root,
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.key === undefined ? {} : { key: options.key }),
          },
        }),
      ),
    removeWorkspace: (id) =>
      Effect.asVoid(
        send(url, APP_ERRORS, () =>
          client.request("DELETE /api/workspaces/:workspace", { params: { workspace: id } }),
        ),
      ),
    fixAll: (workspace) =>
      send(url, APP_ERRORS, () =>
        client.request("POST /api/workspaces/:workspace/diagnostics/fix-all", {
          params: { workspace },
        }),
      ),
  };
};
