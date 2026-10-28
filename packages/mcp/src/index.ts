import type { AttachmentContent } from "@octodo/contract";
import { catalog, FileSuccess, type Operation, type OperationName } from "@octodo/contract/catalog";
import { runOperation, Workspaces, type Workspace } from "@octodo/engine";
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

const ToolFailure = Schema.Struct({ error: Schema.String });

const toFailure = (error: { readonly message: string }) => ({ error: error.message });

const entries = Object.entries(catalog) as Array<[OperationName, Operation]>;

const annotated = <T extends Tool.Any>(tool: T, operation: Operation): T =>
  tool
    .annotate(Tool.Readonly, operation.readonly)
    .annotate(Tool.Destructive, operation.destructive ?? false)
    .annotate(Tool.Idempotent, operation.idempotent ?? false) as T;

/** One tool per catalog operation whose success is a value; a file is not a toolkit result. */
const valueTools = entries.flatMap(([name, operation]) =>
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
            failure: ToolFailure,
            failureMode: "return",
          }),
          operation,
        ),
      ],
);

export const TasksToolkit = Toolkit.make(...valueTools);

/**
 * Opens the workspace a call names. `defaultDir` is where a call without one looks: the directory
 * the stdio server was started in, or none over HTTP, where the caller has no meaningful cwd.
 */
const opener =
  (workspaces: Workspaces["Service"], defaultDir: string | undefined) =>
  (workspace: string | undefined): Effect.Effect<Workspace, { error: string }> => {
    const target = workspace ?? defaultDir;
    if (target === undefined)
      return Effect.fail({ error: "Pass a workspace: call list_workspaces to see them" });
    return Effect.mapError(workspaces.open(target), toFailure);
  };

const run = (
  name: OperationName,
  input: unknown,
  open: ReturnType<typeof opener>,
): Effect.Effect<unknown, { error: string }, Workspaces> =>
  (
    runOperation(name, input as never, open) as Effect.Effect<
      unknown,
      { readonly error: string } | { readonly message: string },
      Workspaces
    >
  ).pipe(Effect.mapError((error) => ("error" in error ? error : toFailure(error))));

export const toolkitLayer = (options: { readonly defaultDir?: string | undefined }) =>
  TasksToolkit.toLayer(
    Effect.gen(function* () {
      const workspaces = yield* Workspaces;
      const open = opener(workspaces, options.defaultDir);
      const handlers = Object.fromEntries(
        valueTools.map((tool) => [
          tool.name,
          (input: unknown) =>
            run(tool.name as OperationName, input, open).pipe(
              Effect.provideService(Workspaces, workspaces),
            ),
        ]),
      );
      return TasksToolkit.of(handlers as never);
    }),
  );

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

const failed = (error: { readonly error: string }) =>
  new McpSchema.CallToolResult({
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error) }],
  });

/** Registers each operation whose success is a file, answering with `fileContent`. */
const fileTools = (options: { readonly defaultDir?: string | undefined }) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const workspaces = yield* Workspaces;
      const open = opener(workspaces, options.defaultDir);
      for (const [name, operation] of entries) {
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
                run(name, input, open).pipe(
                  Effect.map(
                    (file) =>
                      new McpSchema.CallToolResult({
                        content: [fileContent(file as AttachmentContent)],
                      }),
                  ),
                  Effect.catch((error) => Effect.succeed(failed(error))),
                ),
              ),
              Effect.provideService(Workspaces, workspaces),
            ),
        });
      }
    }),
  );

const serverOptions = {
  name: SERVER_NAME,
  version: "0.0.0",
  instructions: INSTRUCTIONS,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26] as const,
};

/** The tools are built from the catalog at runtime, so their layer's requirements are stated here. */
const registerTools = (options: {
  readonly defaultDir?: string | undefined;
}): Layer.Layer<never, never, McpServer.McpServer | Workspaces> =>
  Layer.mergeAll(
    McpServer.toolkit(TasksToolkit).pipe(Layer.provide(toolkitLayer(options))),
    fileTools(options),
  ) as Layer.Layer<never, never, McpServer.McpServer | Workspaces>;

/**
 * MCP over stdio, for agents that launch `octo mcp` as a subprocess. Requires `Stdio` and
 * `Workspaces`. Logs go to stderr, since stdout carries the protocol.
 */
export const stdioLayer = (options: { readonly defaultDir?: string | undefined }) =>
  registerTools(options).pipe(
    Layer.provide(McpServer.layerStdio(serverOptions)),
    Layer.provide(Logger.layer([Logger.withConsoleError(Logger.formatSimple)])),
  );

/** Streamable HTTP MCP endpoint registered on an `HttpRouter`. Requires `Workspaces`. */
export const httpLayer = (options: { readonly path: `/${string}` }) =>
  registerTools({}).pipe(
    Layer.provide(McpServer.layerHttp({ ...serverOptions, path: options.path })),
  );
