import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { InvalidRequest } from "@octodo/contract";
import { Api, Validation } from "@octodo/contract/api";
import { Workspaces } from "@octodo/engine";
import { httpLayer } from "@octodo/mcp";
import { Cause, Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { AppLive } from "./app.ts";
import { OperationsLive } from "./operations.ts";

export interface ServerOptions {
  /** Where workspaces.json lives. */
  readonly home: string;
  readonly port?: number | undefined;
  /** Built web app to serve at `/`. Without it only the API and MCP endpoints are served. */
  readonly webDir?: string | undefined;
}

export interface RunningServer {
  readonly url: string;
  readonly mcpUrl: string;
  readonly close: () => Promise<void>;
}

export const DEFAULT_PORT = 4520;

/** The only address the server listens on: octodo has no authentication (decision 0010). */
const LOOPBACK = "127.0.0.1";

/** A request that does not match its schema is an `InvalidRequest` saying why. */
const ValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(Validation, (error) =>
  error.kind === "Body" || error.kind === "ResponseHeaders"
    ? Effect.fail(error)
    : Effect.fail(new InvalidRequest({ message: error.cause.message })),
);

const ApiLive = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([OperationsLive, AppLive]),
  Layer.provide(ValidationLive),
);

/** An `/api` path no endpoint has is a JSON 404, never the web app. */
const UnknownApiRoute = HttpRouter.add(
  "*",
  "/api/*",
  Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
    HttpServerResponse.jsonUnsafe(
      { _tag: "RouteNotFound", message: `No route ${request.method} ${request.url}` },
      { status: 404 },
    ),
  ),
);

/** The built web app, with every path that is not a file answered by its `index.html`. */
const webApp = (webDir: string | undefined) =>
  webDir !== undefined && existsSync(join(webDir, "index.html"))
    ? HttpStaticServer.layer({ root: webDir, spa: true })
    : Layer.empty;

const failure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  // Callers look for the listen error's code, as EADDRINUSE.
  return error instanceof Error && error.cause instanceof Error ? error.cause : error;
};

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  const node = createServer();
  const routes = Layer.mergeAll(
    ApiLive,
    httpLayer({ path: "/mcp" }),
    UnknownApiRoute,
    webApp(options.webDir),
  );
  const server = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(
      Workspaces.layer({ home: options.home, watch: true }).pipe(Layer.provide(NodeServices.layer)),
    ),
    Layer.provide(
      NodeHttpServer.layer(() => node, { host: LOOPBACK, port: options.port ?? DEFAULT_PORT }),
    ),
  );
  const scope = Scope.makeUnsafe();
  const started = await Effect.runPromiseExit(Layer.buildWithScope(server, scope));
  if (Exit.isFailure(started)) throw failure(started.cause);

  const { port } = node.address() as AddressInfo;
  const url = `http://${LOOPBACK}:${port}`;
  return {
    url,
    mcpUrl: `${url}/mcp`,
    close: async () => {
      // Open event streams never end on their own, so close every connection instead of waiting.
      node.close();
      node.closeAllConnections();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
