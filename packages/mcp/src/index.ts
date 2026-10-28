import {
  InvalidRequest,
  ServerMismatch,
  ServerUnavailable,
  wireErrorsOf,
  type AttachmentContent,
  type StorageError,
  type WorkspaceNotFound,
} from "@octodo/contract";
import { VERSION } from "@octodo/contract/api";
import { FileSuccess, inOneWorkspace, type Operation } from "@octodo/contract/catalog";
import { makeRegistry, Workspaces, type Registry, type Workspace } from "@octodo/engine";
import { Context, Effect, Layer, Logger, Schema } from "effect";
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { pathToFileURL } from "node:url";

export const SERVER_NAME = "octodo";

export const INSTRUCTIONS = `octodo manages tasks stored as markdown files under a project's .octodo/ folder. Use these tools to change them rather than editing files.
- Every task is a folder holding task.md, whose frontmatter has its id, title, status, priority, tags, due date and order. Other files in the folder are its attachments: get_task lists them and read_attachment reads one.
- A task folder inside another task is a subtask: create_task and move_task take a parent task id, and get_task lists a task's subtasks.
- Folders with list.md are lists, nested up to 3 levels. List ids are folder names joined by slashes: garden/seeds.
- Every task has a stable id like HM-42 (the workspace key plus a number). Refer to tasks by id, never by path.
- blocked_by in a task's frontmatter lists the task ids it waits for. A task is blocked while any of them is open or missing; update_task sets blocked_by, and list_tasks with ready: true lists open tasks that are not blocked. [[HM-3]] in a body mentions task HM-3.
- Call get_workspace first to learn the statuses and lists before creating or moving tasks.
- Files that octodo cannot read cleanly show up as diagnostics (list_diagnostics). Fix one with fix_diagnostic when it offers a fix; otherwise tell the user what its message says to do. Never edit the files to fix them.
- The workspace parameter takes a registered workspace id or an absolute folder path; omit it to use the workspace containing the server's working directory.`;

/** Runs an operation by name on its decoded input, the way the process reaches the engine. */
export type RunOperation = (name: string, input: object) => Effect.Effect<unknown, unknown>;

/**
 * A tool's errors as `{ _tag, ...fields, message }`, as HTTP sends them (decision 0006), plus the
 * `InvalidRequest` of a call that names no workspace where the server has none to fall back on,
 * and what a stdio server that uses a running server can meet there (decision 0018).
 */
const failureOf = (operation: Operation): Schema.Codec<unknown, unknown> =>
  Schema.Union([
    ...wireErrorsOf(operation.error),
    ...wireErrorsOf(Schema.Union([InvalidRequest, ServerMismatch, ServerUnavailable])),
  ]) as never;

const annotated = <T extends Tool.Any>(tool: T, operation: Operation): T =>
  tool
    .annotate(Tool.Readonly, operation.readonly)
    .annotate(Tool.Destructive, operation.destructive ?? false)
    .annotate(Tool.Idempotent, operation.idempotent ?? false) as T;

/** One tool per operation whose success is a value; a file is not a toolkit result. */
const valueTools = (operations: Registry["operations"]) =>
  Object.entries(operations).flatMap(([name, operation]) =>
    operation.success === FileSuccess
      ? []
      : [
          annotated(
            Tool.make(name, {
              description: operation.description,
              ...(Object.keys(operation.input.fields).length === 0
                ? {}
                : { parameters: operation.input }),
              success: operation.success as Schema.Top,
              failure: failureOf(operation),
              failureMode: "return",
            }),
            operation,
          ),
        ],
  );

/** The tools of the operations whose success is a value, as one toolkit layer. */
const toolkitTools = (operations: Registry["operations"], run: RunOperation) => {
  const tools = valueTools(operations);
  const toolkit = Toolkit.make(...tools);
  const handlers = toolkit.of(
    Object.fromEntries(
      tools.map((tool) => [tool.name, (input: unknown) => run(tool.name, input as object)]),
    ) as never,
  );
  return McpServer.toolkit(toolkit).pipe(Layer.provide(toolkit.toLayer(handlers)));
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const isText = (mediaType: string) =>
  mediaType.startsWith("text/") || ["application/json", "image/svg+xml"].includes(mediaType);

/** An attachment as the content block an agent can take in: an image, text, or a file. */
const fileContent = (file: AttachmentContent): McpSchema.ContentBlock => {
  const mediaType = file.mediaType.split(";")[0]!.trim();
  if (IMAGE_TYPES.has(mediaType)) return { type: "image", data: file.bytes, mimeType: mediaType };
  if (isText(mediaType)) return { type: "text", text: new TextDecoder().decode(file.bytes) };
  return {
    type: "resource",
    resource: { uri: pathToFileURL(file.file).href, mimeType: file.mediaType, blob: file.bytes },
  };
};

const failed = (operation: Operation, error: unknown) =>
  new McpSchema.CallToolResult({
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(Schema.encodeUnknownSync(failureOf(operation))(error)),
      },
    ],
  });

/** Registers each operation whose success is a file, answering with `fileContent`. */
const fileTools = (operations: Registry["operations"], run: RunOperation) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      for (const [name, operation] of Object.entries(operations)) {
        if (operation.success !== FileSuccess) continue;
        const decode = Schema.decodeUnknownEffect(operation.input) as (
          input: unknown,
          options: { readonly errors: "all" },
        ) => Effect.Effect<unknown, Schema.SchemaError>;
        const tool = annotated(
          Tool.make(name, { description: operation.description, parameters: operation.input }),
          operation,
        );
        yield* server.addTool({
          tool: new McpSchema.Tool({
            name,
            description: operation.description,
            inputSchema: Tool.getJsonSchema(tool) as McpSchema.Tool["inputSchema"],
            annotations: {
              readOnlyHint: operation.readonly,
              destructiveHint: operation.destructive ?? false,
              idempotentHint: operation.idempotent ?? false,
              openWorldHint: true,
            },
          }),
          annotations: Context.empty(),
          handle: (payload) =>
            decode(payload ?? {}, { errors: "all" }).pipe(
              // As the toolkit answers invalid arguments: a protocol error naming the tool.
              Effect.mapError(
                (error) =>
                  new McpSchema.InvalidParams({
                    message: `Invalid parameters for tool '${name}': ${error.message}`,
                  }),
              ),
              Effect.flatMap((input) =>
                run(name, input as object).pipe(
                  Effect.map(
                    (file) =>
                      new McpSchema.CallToolResult({
                        content: [fileContent(file as AttachmentContent)],
                      }),
                  ),
                  Effect.catch((error) => Effect.succeed(failed(operation, error))),
                ),
              ),
            ),
        });
      }
    }),
  );

const serverOptions = {
  name: SERVER_NAME,
  version: VERSION,
  instructions: INSTRUCTIONS,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26] as const,
};

/** Every operation's tool, built at runtime, so the layer's requirements are stated here. */
const tools = (
  operations: Registry["operations"],
  run: RunOperation,
): Layer.Layer<never, never, McpServer.McpServer> =>
  Layer.mergeAll(toolkitTools(operations, run), fileTools(operations, run)) as never;

/**
 * MCP over stdio, for agents that launch `octo mcp` as a subprocess. A call that names no
 * workspace runs in `defaultDir`, the directory the server was started in. Requires `Stdio`.
 * Logs go to stderr, since stdout carries the protocol.
 */
export const stdioLayer = (options: {
  readonly defaultDir: string;
  readonly operations: Registry["operations"];
  readonly run: RunOperation;
}) =>
  tools(options.operations, (name, input) =>
    options.run(
      name,
      inOneWorkspace(options.operations[name]!) && !("workspace" in input)
        ? { ...input, workspace: options.defaultDir }
        : input,
    ),
  ).pipe(
    Layer.provide(McpServer.layerStdio(serverOptions)),
    Layer.provide(Logger.layer([Logger.withConsoleError(Logger.formatSimple)])),
  );

/**
 * Streamable HTTP MCP endpoint registered on an `HttpRouter`, with the tools of the plugins
 * `Workspaces` has. A call over HTTP has no directory to fall back on, so it names its workspace.
 */
export const httpLayer = (options: { readonly path: `/${string}` }) =>
  Layer.unwrap(
    Workspaces.use((workspaces) => {
      const registry = makeRegistry(workspaces.plugins);
      const open = (
        workspace: string | undefined,
      ): Effect.Effect<Workspace, InvalidRequest | WorkspaceNotFound | StorageError> =>
        workspace === undefined
          ? Effect.fail(
              new InvalidRequest({ message: "Pass a workspace: call list_workspaces to see them" }),
            )
          : workspaces.open(workspace);
      const run: RunOperation = (name, input) =>
        registry.run(name, input, open).pipe(Effect.provideService(Workspaces, workspaces));
      return Effect.succeed(tools(registry.operations, run));
    }),
  ).pipe(Layer.provide(McpServer.layerHttp({ ...serverOptions, path: options.path })));
