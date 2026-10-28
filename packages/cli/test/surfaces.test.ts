import { NodeServices } from "@effect/platform-node";
import { Connection } from "@octodo/client";
import {
  catalog,
  FileSuccess,
  inOneWorkspace,
  pathParams,
  type OperationName,
} from "@octodo/contract/catalog";
import { ApiError, createClient, type JsonRouteKey, type RouteKey } from "@octodo/contract/client";
import { runOperation, Workspaces, type OperationInput } from "@octodo/engine";
import { startServer, type RunningServer } from "@octodo/server";
import { Effect, Layer, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { octo, registry } from "../src/octo.ts";

/** What a surface gave back, made comparable: a value, a file's bytes, or an error's message. */
type Outcome =
  | { readonly value: unknown }
  | { readonly base64: string }
  | { readonly error: string };

interface Surface {
  readonly root: string;
  readonly run: (row: Row) => Promise<Outcome | null>;
}

interface Row {
  readonly name: OperationName;
  /** `<root>` in a value stands for the surface's workspace folder. */
  readonly input: Record<string, unknown>;
  /** The same call as `octo` words, or none when the operation has no command. */
  readonly argv?: ReadonlyArray<string>;
  /** Changes the workspace's files before the call, as a person or a sync tool would. */
  readonly before?: (root: string) => void;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

const ROWS: ReadonlyArray<Row> = [
  { name: "create_list", input: { name: "Garden" }, argv: ["lists", "create", "Garden", "--json"] },
  {
    name: "create_list",
    input: { name: "Seeds", parent: "garden" },
    argv: ["lists", "create", "Seeds", "--parent", "garden", "--json"],
  },
  {
    name: "create_task",
    input: { title: "Paint", priority: "high", tags: ["diy", "walls"], list: "garden" },
    argv: ["create", "Paint", "-p", "high", "-t", "diy,walls", "-l", "garden", "--json"],
  },
  {
    name: "create_task",
    input: { title: "Prime", parent: "HM-1", due: "2026-11-01" },
    argv: ["create", "Prime", "--parent", "HM-1", "--due", "2026-11-01", "--json"],
  },
  { name: "create_task", input: { title: "Sweep" }, argv: ["create", "Sweep", "--json"] },
  {
    name: "update_task",
    input: { id: "HM-1", body: "See [[HM-3]]", blocked_by: ["HM-3"], due: null },
    argv: [
      "update",
      "HM-1",
      "--body",
      "See [[HM-3]]",
      "--blocked-by",
      "HM-3",
      "--no-due",
      "--json",
    ],
  },
  {
    name: "move_task",
    input: { id: "HM-3", status: "done" },
    argv: ["move", "HM-3", "done", "--json"],
  },
  {
    name: "move_task",
    input: { id: "HM-2", parent: null, before: "HM-1" },
    argv: ["move", "HM-2", "--no-parent", "--before", "HM-1", "--json"],
  },
  {
    name: "move_list",
    input: { id: "garden/seeds", parent: null },
    argv: ["lists", "move", "garden/seeds", "--no-parent", "--json"],
  },
  { name: "list_tasks", input: {}, argv: ["list", "--json"] },
  {
    name: "list_tasks",
    input: { all: true, query: "SWE" },
    argv: ["list", "--all", "--query", "SWE", "--json"],
  },
  { name: "list_tasks", input: { ready: true }, argv: ["list", "--ready", "--json"] },
  {
    name: "get_task",
    input: { id: "HM-1" },
    argv: ["show", "HM-1", "--json"],
    before: (root) => {
      const folder = join(root, ".octodo", "garden", "HM-1-paint");
      mkdirSync(join(folder, "images"));
      writeFileSync(join(folder, "images", "plan.png"), PNG);
      writeFileSync(join(folder, "notes.txt"), "two coats");
    },
  },
  {
    name: "read_attachment",
    input: { id: "HM-1", path: "images/plan.png" },
    argv: ["attachment", "HM-1", "images/plan.png"],
  },
  {
    name: "read_attachment",
    input: { id: "HM-1", path: "notes.txt" },
    argv: ["attachment", "HM-1", "notes.txt"],
  },
  {
    name: "read_attachment",
    input: { id: "HM-1", path: "images/none.png" },
    argv: ["attachment", "HM-1", "images/none.png"],
  },
  { name: "get_task", input: { id: "HM-9" }, argv: ["show", "HM-9", "--json"] },
  { name: "read_attachment", input: { id: "HM-1" } },
  {
    name: "update_task",
    input: { id: "HM-1", title: "" },
    argv: ["update", "HM-1", "--title", ""],
  },
  {
    name: "list_diagnostics",
    input: {},
    before: (root) =>
      writeFileSync(join(root, ".octodo", "loose.md"), "---\ntitle: Loose\n---\nA plan\n"),
  },
  { name: "get_workspace", input: {} },
  {
    name: "fix_diagnostic",
    input: { path: ".octodo/loose.md", kind: "loose-markdown", action: "wrap-as-task" },
  },
  { name: "delete_task", input: { id: "HM-3" }, argv: ["delete", "HM-3", "--json"] },
  { name: "list_plugins", input: {}, argv: ["plugins", "list", "--json"] },
  {
    name: "enable_plugin",
    input: { plugin: "recurring" },
    argv: ["plugins", "enable", "recurring", "--json"],
  },
  { name: "enable_plugin", input: { plugin: "recurring" } },
  { name: "enable_plugin", input: { plugin: "juggling" } },
  {
    name: "disable_plugin",
    input: { plugin: "recurring" },
    argv: ["plugins", "disable", "recurring", "--json"],
  },
  { name: "disable_plugin", input: { plugin: "juggling" } },
  {
    name: "add_workspace",
    input: { root: "<root>/cabin", key: "CB", preset: "chores" },
    argv: ["init", "<root>/cabin", "--key", "CB", "--preset", "chores", "--json"],
  },
  {
    name: "add_workspace",
    input: { root: "<root>/cabin", preset: "checklist" },
    argv: ["init", "<root>/cabin", "--preset", "checklist", "--json"],
  },
  { name: "add_workspace", input: { root: "<root>/shed", preset: "barn" } },
  { name: "add_workspace", input: { root: "cabin" } },
  { name: "list_workspaces", input: {}, argv: ["workspace", "list", "--json"] },
];

/** The row with `<root>` in its input and its words made the folder `root`. */
const at = (row: Row, root: string): Row => ({
  ...row,
  input: JSON.parse(JSON.stringify(row.input).replaceAll("<root>", root)),
  ...(row.argv === undefined
    ? {}
    : { argv: row.argv.map((word) => word.replaceAll("<root>", root)) }),
});

const scratch = mkdtempSync(join(tmpdir(), "octodo-surfaces-"));

/** A fresh workspace named `house` in its own folder, with its own octodo home. */
const workspaceFor = async (surface: string) => {
  const home = join(scratch, surface, "home");
  const root = join(scratch, surface, "house");
  mkdirSync(root, { recursive: true });
  await Effect.runPromise(
    Workspaces.use((workspaces) => workspaces.add(root, { key: "HM" })).pipe(
      Effect.provide(Workspaces.layer({ home, watch: false, plugins: registry.plugins })),
      Effect.provide(NodeServices.layer),
    ),
  );
  return { home, root };
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const engineSurface = async (): Promise<Surface> => {
  const { home, root } = await workspaceFor("engine");
  return {
    root,
    run: ({ name, input }) =>
      Effect.runPromise(
        Schema.decodeUnknownEffect(catalog[name].input as Schema.Codec<unknown>)(input, {
          errors: "all",
        }).pipe(
          Effect.flatMap((decoded) =>
            runOperation(name, decoded as OperationInput<typeof name>, () =>
              Workspaces.use((workspaces) => workspaces.open(root)),
            ),
          ),
          Effect.map((value): Outcome =>
            name === "read_attachment"
              ? { base64: toBase64((value as { readonly bytes: Uint8Array }).bytes) }
              : { value },
          ),
          Effect.catch((error) => Effect.succeed<Outcome>({ error: error.message })),
          Effect.provide(Workspaces.layer({ home, watch: false, plugins: registry.plugins })),
          Effect.provide(NodeServices.layer),
        ),
      ),
  };
};

let server: RunningServer | undefined;

const mcpSurface = async (): Promise<Surface> => {
  const { home, root } = await workspaceFor("mcp");
  server = await startServer({ home, port: 0 });
  const url = `${server.url}/mcp`;
  let session: string | null = null;
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(session === null ? {} : { "mcp-session-id": session }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    session ??= response.headers.get("mcp-session-id");
    return response.json() as Promise<{
      result?: Record<string, any>;
      error?: { readonly message: string };
    }>;
  };
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "surfaces", version: "0" },
  });
  return {
    root,
    run: async ({ name, input }) => {
      const { result, error } = await rpc("tools/call", {
        name,
        arguments: inOneWorkspace(catalog[name]) ? { workspace: root, ...input } : input,
      });
      // Effect's McpServer answers invalid arguments with a protocol error naming the tool.
      if (result === undefined)
        return { error: error!.message.replace(`Invalid parameters for tool '${name}': `, "") };
      const [block] = result["content"] as Array<Record<string, string>>;
      if (result["isError"] === true) return { error: JSON.parse(block!["text"]!).message };
      if (block!["type"] === "image") return { base64: block!["data"]! };
      if (name === "read_attachment")
        return { base64: Buffer.from(block!["text"]!).toString("base64") };
      return { value: result["structuredContent"] ?? JSON.parse(block!["text"]!) };
    },
  };
};

let httpServer: RunningServer | undefined;

/** Calls each operation at its generated route, through the browser's typed client. */
const httpSurface = async (): Promise<Surface> => {
  const { home, root } = await workspaceFor("http");
  httpServer = await startServer({ home, port: 0 });
  const client = createClient(httpServer.url);
  return {
    root,
    run: async ({ name, input }) => {
      const { http } = catalog[name];
      const inPath = pathParams(http);
      const values: Record<string, unknown> = { workspace: "house", ...input };
      // A path parameter cannot be left out of a URL.
      if (inPath.some((key) => values[key] === undefined)) return null;
      const params = Object.fromEntries(inPath.map((key) => [key, values[key]]));
      const rest = Object.fromEntries(
        Object.entries(values).filter(([key]) => !inPath.includes(key) && key !== "workspace"),
      );
      const key = `${http.method} /api${http.path}` as RouteKey;
      const request = {
        params,
        ...(Object.keys(rest).length === 0
          ? {}
          : http.method === "GET"
            ? { query: rest }
            : { payload: rest }),
      } as never;
      try {
        if (catalog[name].success !== FileSuccess)
          return { value: await client.request(key as JsonRouteKey, request) };
        const response = await fetch(client.url(key, request));
        if (!response.ok) throw new ApiError(response.status, await response.json());
        return { base64: toBase64(new Uint8Array(await response.arrayBuffer())) };
      } catch (error) {
        if (error instanceof ApiError) return { error: error.message };
        throw error;
      }
    },
  };
};

let cliServer: RunningServer | undefined;

/** The CLI on the engine in-process, or through a server running in its octodo home. */
const cliSurface = async (mode: "embedded" | "served"): Promise<Surface> => {
  const surface = mode === "embedded" ? "cli" : "cli-served";
  const { home, root } = await workspaceFor(surface);
  if (mode === "served") cliServer = await startServer({ home, port: 0 });
  const saved = join(scratch, surface, "saved");
  return {
    root,
    run: async ({ argv, name }) => {
      if (argv === undefined) return null;
      const file = name === "read_attachment" ? ["--output", saved] : [];
      const run = Command.runWith(octo, { version: "0.0.0", renderErrors: false })([
        ...argv,
        ...file,
        "--workspace",
        root,
      ]).pipe(
        Effect.andThen(TestConsole.logLines),
        Effect.map((lines): Outcome =>
          name === "read_attachment"
            ? { base64: readFileSync(saved).toString("base64") }
            : { value: JSON.parse(lines.join("\n")) },
        ),
        Effect.catch((error) =>
          Effect.succeed<Outcome>({
            error:
              error._tag === "ShowHelp"
                ? error.errors.map((cause) => cause.message).join("\n")
                : error.message,
          }),
        ),
        Effect.provide(
          Layer.mergeAll(
            Connection.layer({ home, registry, watch: false }),
            TestConsole.layer,
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      );
      return Effect.runPromise(run as Effect.Effect<Outcome>);
    },
  };
};

/** The outcome with what differs between two folders on one machine masked. */
const comparable = (outcome: Outcome, root: string) =>
  JSON.parse(
    JSON.stringify(outcome)
      .replaceAll(root, "<root>")
      .replaceAll(/"(created|updated)":"[^"]+"/g, '"$1":"<time>"'),
  );

let surfaces: Record<"engine" | "mcp" | "http" | "cli" | "cli-served", Surface>;

beforeAll(async () => {
  surfaces = {
    engine: await engineSurface(),
    mcp: await mcpSurface(),
    http: await httpSurface(),
    cli: await cliSurface("embedded"),
    "cli-served": await cliSurface("served"),
  };
});

afterAll(() => Promise.all([server?.close(), httpServer?.close(), cliServer?.close()]));

describe("every operation on every surface", () => {
  it("covers every catalog operation, and every command, in the table", () => {
    const names = Object.keys(catalog) as Array<OperationName>;
    expect(names.filter((name) => !ROWS.some((row) => row.name === name))).toEqual([]);
    expect(
      names.filter(
        (name) =>
          "cli" in catalog[name] &&
          !ROWS.some((row) => row.name === name && row.argv !== undefined),
      ),
    ).toEqual([]);
  });

  it("gives the same result, file or error on the engine, over MCP, over HTTP and from the CLI with and without a server", async () => {
    const seen = {
      engine: [] as Array<unknown>,
      mcp: [] as Array<unknown>,
      http: [] as Array<unknown>,
      cli: [] as Array<unknown>,
      "cli-served": [] as Array<unknown>,
    };
    for (const row of ROWS) {
      const step = `${row.name} ${JSON.stringify(row.input)}`;
      for (const [surface, { root, run }] of Object.entries(surfaces) as Array<
        [keyof typeof seen, Surface]
      >) {
        row.before?.(root);
        const call = at(row, root);
        let outcome = await run(call);
        // The server learns of a hand-made change from its file watcher, a moment later.
        const served = surface === "mcp" || surface === "http" || surface === "cli-served";
        for (let wait = 0; served && row.before !== undefined && wait < 20; wait++) {
          if (isDeepStrictEqual(comparable(outcome!, root), seen.engine.at(-1))) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
          outcome = await run(call);
        }
        seen[surface].push(outcome === null ? { step, none: surface } : comparable(outcome, root));
      }
    }
    const steps = ROWS.map((row) => `${row.name} ${JSON.stringify(row.input)}`);
    const expected = seen.engine.map((outcome, index) => ({ step: steps[index], outcome }));
    const on = (surface: keyof typeof seen) =>
      seen[surface].map((outcome, index) => ({ step: steps[index], outcome }));
    expect(on("mcp")).toEqual(expected);
    const without = (surface: string, absent: (row: Row) => boolean) =>
      expected.map((entry, index) =>
        absent(ROWS[index]!)
          ? { step: entry.step, outcome: { step: entry.step, none: surface } }
          : entry,
      );
    expect(on("http")).toEqual(
      without("http", (row) =>
        pathParams(catalog[row.name].http).some(
          (key) => key !== "workspace" && row.input[key] === undefined,
        ),
      ),
    );
    expect(on("cli")).toEqual(without("cli", (row) => row.argv === undefined));
    expect(on("cli-served")).toEqual(without("cli-served", (row) => row.argv === undefined));
  }, 30_000);
});
