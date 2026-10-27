import { sValidator } from "@hono/standard-validator";
import {
  CreateListInput,
  CreateTaskInput,
  FixRequest,
  MoveListInput,
  MoveTaskInput,
  ReorderStatusesInput,
  UpdateTaskInput,
  WorkspaceKey,
  Workspaces,
  type InvalidRequest,
  type StorageError,
  type TaskNotFound,
  type Workspace,
  type WorkspaceNotFound,
} from "@octodo/core";
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream, type ManagedRuntime } from "effect";
import { Hono, type Context } from "hono";
import { homedir } from "node:os";
import { bodyLimit } from "hono/body-limit";
import { setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { fileResponse, MAX_ATTACHMENT_BYTES } from "./attachments.ts";
import { SESSION_COOKIE, pairUrl, requireToken, tokenMatches } from "./auth.ts";

type ApiError = TaskNotFound | WorkspaceNotFound | InvalidRequest | StorageError;

const STATUS = {
  TaskNotFound: 404,
  WorkspaceNotFound: 404,
  InvalidRequest: 400,
  StorageError: 500,
} as const;

const MoveListBody = Schema.Struct({ id: Schema.String, ...MoveListInput.fields });

const body = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  sValidator("json", Schema.toStandardSchemaV1(schema), (result, c) => {
    if (!result.success) {
      const issues = result.error.map((issue) => {
        const at = issue.path
          ?.map((part) => (typeof part === "object" ? String(part.key) : String(part)))
          .join(".");
        return at ? `${at}: ${issue.message}` : issue.message;
      });
      return c.json({ error: issues.join("; ") }, 400);
    }
  });

const AddWorkspaceInput = Schema.Struct({
  // Relative paths would resolve against the server's own working directory.
  root: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^\//, { message: "Use an absolute folder path" })),
  ),
  name: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(WorkspaceKey),
});

const PairInput = Schema.Struct({ token: Schema.String });

export interface AppOptions {
  readonly runtime: ManagedRuntime.ManagedRuntime<Workspaces, never>;
  readonly token: string;
  /** The address the server listens on, known once it has started. */
  readonly serverUrl: () => string;
  /** Handles `/mcp`; built separately because it runs on Effect's HTTP router. */
  readonly mcp?: ((request: Request) => Promise<Response>) | undefined;
}

const pairCookie = (c: Context, token: string) =>
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

export const createApi = ({ runtime, token, serverUrl }: AppOptions) => {
  const failed = (c: Context, cause: Cause.Cause<ApiError>) => {
    const failure = Cause.findErrorOption(cause);
    if (Option.isSome(failure)) {
      return c.json({ error: failure.value.message }, STATUS[failure.value._tag]);
    }
    console.error(Cause.pretty(cause));
    return c.json({ error: "Internal error" }, 500);
  };

  const run = async <A>(c: Context, effect: Effect.Effect<A, ApiError, Workspaces>) => {
    const exit = await runtime.runPromiseExit(effect);
    return Exit.isSuccess(exit) ? c.json(exit.value, 200) : failed(c, exit.cause);
  };

  const inWorkspace = <A>(
    c: Context<any, `/workspaces/:ws${string}`>,
    effect: (workspace: Workspace) => Effect.Effect<A, ApiError, Workspaces>,
  ) => Workspaces.use((workspaces) => Effect.flatMap(workspaces.get(c.req.param("ws")), effect));

  const runInWorkspace = <A>(
    c: Context<any, `/workspaces/:ws${string}`>,
    effect: (workspace: Workspace) => Effect.Effect<A, ApiError, Workspaces>,
  ) => run(c, inWorkspace(c, effect));

  return (
    new Hono()
      .get("/health", (c) => c.json({ ok: true }))
      // Pairing: a link carrying the token (desktop window, QR code) or a typed-in token.
      .get("/pair", (c) => {
        if (!tokenMatches(token, c.req.query("token")))
          return c.json({ error: "Wrong token" }, 401);
        pairCookie(c, token);
        const next = c.req.query("next") ?? "/";
        return c.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
      })
      .post("/pair", body(PairInput), (c) => {
        if (!tokenMatches(token, c.req.valid("json").token))
          return c.json({ error: "Wrong token" }, 401);
        pairCookie(c, token);
        return c.json({ ok: true }, 200);
      })
      .use(requireToken(token))
      .get("/session", (c) => c.json({ ok: true }))
      // What an agent or another device needs to connect. Paired clients already hold the token.
      .get("/connection", (c) => {
        const url = serverUrl();
        c.header("Cache-Control", "no-store");
        return c.json({ url, mcpUrl: `${url}/mcp`, pairUrl: pairUrl(url, token), token }, 200);
      })
      // A folder browser for adding workspaces from a client without a native picker.
      .get("/folders", (c) =>
        run(
          c,
          Workspaces.use((w) => w.browse(c.req.query("path") || homedir())),
        ),
      )
      .get("/workspaces", (c) =>
        run(
          c,
          Workspaces.use((w) => w.list),
        ),
      )
      .post("/workspaces", body(AddWorkspaceInput), (c) => {
        const { root, ...options } = c.req.valid("json");
        return run(
          c,
          Workspaces.use((w) => w.add(root, options)),
        );
      })
      .delete("/workspaces/:ws", (c) =>
        run(
          c,
          Workspaces.use((w) => Effect.as(w.remove(c.req.param("ws")), { ok: true })),
        ),
      )
      .get("/workspaces/:ws", (c) => runInWorkspace(c, (ws) => ws.snapshot))
      .post("/workspaces/:ws/tasks", body(CreateTaskInput), (c) =>
        runInWorkspace(c, (ws) => ws.createTask(c.req.valid("json"))),
      )
      .get("/workspaces/:ws/tasks/:id", (c) =>
        runInWorkspace(c, (ws) => ws.getTask(c.req.param("id"))),
      )
      .patch("/workspaces/:ws/tasks/:id", body(UpdateTaskInput), (c) =>
        runInWorkspace(c, (ws) => ws.updateTask(c.req.param("id"), c.req.valid("json"))),
      )
      .post("/workspaces/:ws/tasks/:id/move", body(MoveTaskInput), (c) =>
        runInWorkspace(c, (ws) => ws.moveTask(c.req.param("id"), c.req.valid("json"))),
      )
      .delete("/workspaces/:ws/tasks/:id", (c) =>
        runInWorkspace(c, (ws) => Effect.as(ws.deleteTask(c.req.param("id")), { ok: true })),
      )
      .get("/workspaces/:ws/tasks/:id/files/:path{.+}", async (c) => {
        const exit = await runtime.runPromiseExit(
          inWorkspace(c, (ws) => ws.attachmentPath(c.req.param("id"), c.req.param("path"))),
        );
        if (Exit.isFailure(exit)) return failed(c, exit.cause);
        return (await fileResponse(exit.value)) ?? c.json({ error: "No such file" }, 404);
      })
      // The raw request body becomes the file; a taken name gets -2, -3, and the reply says which.
      .put(
        "/workspaces/:ws/tasks/:id/files/:path{.+}",
        bodyLimit({
          maxSize: MAX_ATTACHMENT_BYTES,
          onError: (c) =>
            c.json({ error: `Attachments are limited to ${MAX_ATTACHMENT_BYTES >> 20} MB` }, 413),
        }),
        async (c) => {
          const bytes = new Uint8Array(await c.req.arrayBuffer());
          return runInWorkspace(c, (ws) =>
            Effect.map(
              ws.writeAttachment(c.req.param("id"), c.req.param("path"), bytes),
              (path) => ({ path }),
            ),
          );
        },
      )
      .post("/workspaces/:ws/lists", body(CreateListInput), (c) =>
        runInWorkspace(c, (ws) => ws.createList(c.req.valid("json"))),
      )
      // List ids contain slashes, so the id travels in the body rather than the path.
      .post("/workspaces/:ws/lists/move", body(MoveListBody), (c) =>
        runInWorkspace(c, (ws) => {
          const { id, ...input } = c.req.valid("json");
          return ws.moveList(id, input);
        }),
      )
      // Fixes run only when asked, each against a fresh read: a stale request changes nothing.
      .post("/workspaces/:ws/diagnostics/fix", body(FixRequest), (c) =>
        runInWorkspace(c, (ws) => ws.fixDiagnostic(c.req.valid("json"))),
      )
      .post("/workspaces/:ws/diagnostics/fix-all", (c) => runInWorkspace(c, (ws) => ws.fixAll))
      .put("/workspaces/:ws/statuses/order", body(ReorderStatusesInput), (c) =>
        runInWorkspace(c, (ws) => ws.reorderStatuses(c.req.valid("json"))),
      )
      // Server-sent events: `change` with `{ workspace }` whenever files in an open workspace change.
      .get("/events", (c) =>
        streamSSE(c, async (stream) => {
          const fiber = runtime.runFork(
            Workspaces.use((w) =>
              Stream.runForEach(w.changes, (change) =>
                Effect.promise(() =>
                  stream.writeSSE({ event: "change", data: JSON.stringify(change) }),
                ),
              ),
            ),
          );
          const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
          await new Promise<void>((resolve) => stream.onAbort(resolve));
          clearInterval(ping);
          await runtime.runPromise(Fiber.interrupt(fiber));
        }),
      )
  );
};

export type Api = ReturnType<typeof createApi>;
