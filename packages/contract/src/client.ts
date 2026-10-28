/**
 * The browser's client for the HTTP API: `fetch`, typed from the API definition through type-only
 * imports, so no Effect code reaches the bundle (decision 0006). Each route is named by its method
 * and path, as `"GET /api/workspaces/:workspace"`.
 */
import type { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import type { Api } from "./api.ts";

type Endpoints =
  typeof Api extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? HttpApiGroup.Endpoints<Groups>
    : never;

type Part<S> = [S] extends [never] ? undefined : S extends { readonly Type: infer T } ? T : never;

type RouteOf<E> =
  E extends HttpApiEndpoint.HttpApiEndpoint<
    infer _Name,
    infer Method,
    infer Path,
    infer Params,
    infer Query,
    infer Payload,
    infer _Headers,
    infer Success,
    infer Error,
    infer _Middleware,
    infer _MiddlewareServices
  >
    ? {
        readonly key: `${Method} ${Path}`;
        readonly params: Part<Params>;
        readonly query: Part<Query>;
        readonly payload: [Payload] extends [never]
          ? undefined
          : Payload extends HttpApiSchema.StreamUint8Array
            ? Blob | ArrayBuffer | Uint8Array<ArrayBuffer>
            : Part<Payload>;
        readonly success: Part<Success>;
        readonly error: Part<Error>;
        readonly streams: Success extends HttpApiSchema.StreamSchema ? true : false;
      }
    : never;

type Routes = RouteOf<Endpoints>;

/** A route by its method and path: `"PATCH /api/workspaces/:workspace/tasks/:id"`. */
export type RouteKey = Routes["key"];

/** The routes whose body is JSON, which `request` reads; a file or a stream is read through `url`. */
export type JsonRouteKey = Extract<Routes, { readonly streams: false }>["key"];

type RouteFor<K extends RouteKey> = Extract<Routes, { readonly key: K }>;

type Optional<Name extends string, T> = [T] extends [undefined]
  ? {}
  : {} extends T
    ? { readonly [_ in Name]?: T }
    : { readonly [_ in Name]: T };

export type Input<K extends RouteKey> = Optional<"params", RouteFor<K>["params"]> &
  Optional<"query", RouteFor<K>["query"]> &
  Optional<"payload", RouteFor<K>["payload"]>;

export type Success<K extends RouteKey> = RouteFor<K>["success"];

/** What the server sent for a failed request: `{ _tag, ...fields, message }` (decision 0006). */
export type ErrorBody<K extends RouteKey> = RouteFor<K>["error"];

export class ApiError<Body = unknown> extends Error {
  readonly status: number;
  /** The error the server sent, or undefined when the response was not one. */
  readonly body: Body | undefined;
  constructor(status: number, body: Body | undefined) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String(body.message)
        : `Request failed (${status})`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** A query value as the server's schemas read it: `null` is `"null"`, a list repeats the key. */
const queryValues = (value: unknown): Array<string> =>
  value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)];

const isBytes = (payload: unknown): payload is BodyInit =>
  payload instanceof Blob || payload instanceof ArrayBuffer || payload instanceof Uint8Array;

export const createClient = (baseUrl: string) => {
  const base = baseUrl.replace(/\/$/, "");

  /** The URL of a route; each path parameter is one percent-encoded segment. */
  const url = <K extends RouteKey>(key: K, input: Input<K>): string => {
    const { params, query } = input as {
      readonly params?: Record<string, string>;
      readonly query?: Record<string, unknown>;
    };
    const path = key
      .slice(key.indexOf(" ") + 1)
      .replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params![name]!));
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query ?? {}))
      for (const each of queryValues(value)) search.append(name, each);
    const qs = search.toString();
    return `${base}${path}${qs === "" ? "" : `?${qs}`}`;
  };

  /** Sends a request and resolves to its success, or rejects with an `ApiError`. */
  const request = async <K extends JsonRouteKey>(key: K, input: Input<K>): Promise<Success<K>> => {
    const { payload } = input as { readonly payload?: unknown };
    const response = await fetch(url(key, input), {
      method: key.slice(0, key.indexOf(" ")),
      ...(payload === undefined
        ? {}
        : isBytes(payload)
          ? { body: payload, headers: { "content-type": "application/octet-stream" } }
          : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
    });
    const body: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) throw new ApiError<ErrorBody<K>>(response.status, body as never);
    return body as Success<K>;
  };

  return { url, request };
};

export type Client = ReturnType<typeof createClient>;
