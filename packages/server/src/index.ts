import { NodeServices } from "@effect/platform-node";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Workspaces } from "@octodo/core";
import { httpLayer } from "@octodo/mcp";
import { Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { createApi } from "./app.ts";

export type { Api } from "./app.ts";

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

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  // One memo map so the API runtime and the MCP handler share the same Workspaces instance,
  // and therefore the same caches, locks and file watchers.
  const memoMap = Layer.makeMemoMapUnsafe();
  const workspacesLayer = Workspaces.layer({ home: options.home, watch: true }).pipe(
    Layer.provide(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(workspacesLayer, { memoMap });
  const mcp = HttpRouter.toWebHandler(
    httpLayer({ path: "/mcp" }).pipe(
      Layer.provide(workspacesLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    { memoMap, disableLogger: true },
  );

  let url = "";
  const api = createApi({ runtime, serverUrl: () => url });
  const app = new Hono().route("/api", api).all("/mcp", (c) => mcp.handler(c.req.raw));

  const webDir = options.webDir;
  if (webDir !== undefined && existsSync(join(webDir, "index.html"))) {
    const index = readFileSync(join(webDir, "index.html"), "utf8");
    app.use("/*", serveStatic({ root: relative(process.cwd(), webDir) }));
    app.get("*", (c) => c.html(index));
  }

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve(
      { fetch: app.fetch, hostname: LOOPBACK, port: options.port ?? DEFAULT_PORT },
      () => resolve(instance),
    );
  });
  const { port } = server.address() as AddressInfo;
  url = `http://${LOOPBACK}:${port}`;

  return {
    url,
    mcpUrl: `${url}/mcp`,
    close: async () => {
      // Open event streams never end on their own, so close every connection instead of waiting.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      if ("closeAllConnections" in server) server.closeAllConnections();
      await closed;
      await mcp.dispose();
      await runtime.dispose();
    },
  };
};
