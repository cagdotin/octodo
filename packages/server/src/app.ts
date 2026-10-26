import { sValidator } from "@hono/standard-validator";
import {
  CreateListInput,
  CreateTaskInput,
  MoveTaskInput,
  UpdateTaskInput,
  Workspaces,
  type InvalidRequest,
  type StorageError,
  type TaskNotFound,
  type WorkspaceNotFound,
} from "@tasksmd/core";
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream, type ManagedRuntime } from "effect";
import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { SESSION_COOKIE, requireToken, tokenMatches } from "./auth.ts";

type ApiError = TaskNotFound | WorkspaceNotFound | InvalidRequest | StorageError;

const STATUS = {
  TaskNotFound: 404,
  WorkspaceNotFound: 404,
  InvalidRequest: 400,
  StorageError: 500,
} as const;

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
  key: Schema.optionalKey(Schema.String),
});

const PairInput = Schema.Struct({ token: Schema.String });

const errorMessage = (error: ApiError): string => {
  switch (error._tag) {
    case "TaskNotFound":
      return `No task with id ${error.id}`;
    case "WorkspaceNotFound":
      return `No workspace ${error.workspace}`;
    default:
      return error.message;
  }
};

export interface AppOptions {
  readonly runtime: ManagedRuntime.ManagedRuntime<Workspaces, never>;
  readonly token: string;
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

export const createApi = ({ runtime, token }: AppOptions) => {
  const run = async <A>(c: Context, effect: Effect.Effect<A, ApiError, Workspaces>) => {
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return c.json(exit.value, 200);
    const failure = Cause.findErrorOption(exit.cause);
    if (Option.isSome(failure)) {
      return c.json({ error: errorMessage(failure.value) }, STATUS[failure.value._tag]);
    }
    console.error(Cause.pretty(exit.cause));
    return c.json({ error: "Internal error" }, 500);
  };

  const withWorkspace = (id: string) => Workspaces.use((workspaces) => workspaces.get(id));

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
      .get("/workspaces/:ws", (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) => ws.snapshot),
        ),
      )
      .post("/workspaces/:ws/tasks", body(CreateTaskInput), (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) =>
            ws.createTask(c.req.valid("json")),
          ),
        ),
      )
      .get("/workspaces/:ws/tasks/:id", (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) => ws.getTask(c.req.param("id"))),
        ),
      )
      .patch("/workspaces/:ws/tasks/:id", body(UpdateTaskInput), (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) =>
            ws.updateTask(c.req.param("id"), c.req.valid("json")),
          ),
        ),
      )
      .post("/workspaces/:ws/tasks/:id/move", body(MoveTaskInput), (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) =>
            ws.moveTask(c.req.param("id"), c.req.valid("json")),
          ),
        ),
      )
      .delete("/workspaces/:ws/tasks/:id", (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) =>
            Effect.as(ws.deleteTask(c.req.param("id")), { ok: true }),
          ),
        ),
      )
      .post("/workspaces/:ws/lists", body(CreateListInput), (c) =>
        run(
          c,
          Effect.flatMap(withWorkspace(c.req.param("ws")), (ws) =>
            ws.createList(c.req.valid("json")),
          ),
        ),
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
