import { NodeServices } from "@effect/platform-node";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Workspaces } from "@tasksmd/core";
import { httpLayer } from "@tasksmd/mcp";
import { Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { createApi } from "./app.ts";
import { hostGuard, loadToken, tokenMatches } from "./auth.ts";

export type { Api } from "./app.ts";

export interface ServerOptions {
  /** Where workspaces.json and server.json live. */
  readonly home: string;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  /** Built web app to serve at `/`. Without it only the API and MCP endpoints are served. */
  readonly webDir?: string | undefined;
  /** Extra Host names to accept besides loopback and IP addresses, e.g. a Tailscale name. */
  readonly allowedHosts?: ReadonlyArray<string> | undefined;
}

export interface RunningServer {
  readonly url: string;
  readonly token: string;
  /** Opens the app and signs the browser in. */
  readonly pairUrl: string;
  readonly mcpUrl: string;
  readonly close: () => Promise<void>;
}

export const DEFAULT_PORT = 4520;

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  const host = options.host ?? "127.0.0.1";
  const token = loadToken(options.home);

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

  const api = createApi({ runtime, token });
  const app = new Hono()
    .use(hostGuard(options.allowedHosts ?? []))
    .route("/api", api)
    .use("/mcp", async (c, next) => {
      const header = c.req.header("authorization");
      if (!tokenMatches(token, header?.startsWith("Bearer ") ? header.slice(7) : undefined))
        return c.json({ error: "MCP over HTTP needs Authorization: Bearer <token>" }, 401);
      return next();
    })
    .all("/mcp", (c) => mcp.handler(c.req.raw));

  const webDir = options.webDir;
  if (webDir !== undefined && existsSync(join(webDir, "index.html"))) {
    const index = readFileSync(join(webDir, "index.html"), "utf8");
    app.use("/*", serveStatic({ root: relative(process.cwd(), webDir) }));
    app.get("*", (c) => c.html(index));
  }

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve(
      { fetch: app.fetch, hostname: host, port: options.port ?? DEFAULT_PORT },
      () => resolve(instance),
    );
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;

  return {
    url,
    token,
    pairUrl: `${url}/api/pair?token=${encodeURIComponent(token)}&next=/`,
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
