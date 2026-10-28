import { VERSION, type ServedApi } from "@octodo/contract/api";
import { Workspaces } from "@octodo/engine";
import { Effect, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { homedir } from "node:os";
import { uploadedBytes } from "./attachments.ts";

const ping = { event: "ping", data: "" } as const;

/** Implements the endpoints the apps need that are not catalog operations. */
export const appLive = (api: ServedApi) =>
  HttpApiBuilder.group(
    api,
    "app",
    Effect.fnUntraced(function* (handlers) {
      const workspaces = yield* Workspaces;
      const url = HttpServer.formatAddress((yield* HttpServer.HttpServer).address);
      return (
        handlers
          .handle("health", () =>
            Effect.succeed({
              version: VERSION,
              capabilities: { operations: true, mcp: true, openapi: true },
            }),
          )
          .handle("connection", () => Effect.succeed({ url, mcpUrl: `${url}/mcp` }))
          .handle("folders", ({ query }) => workspaces.browse(query.path ?? homedir()))
          .handle("add_workspace", ({ payload: { root, ...options } }) =>
            workspaces.add(root, options),
          )
          .handle("remove_workspace", ({ params: { workspace } }) =>
            Effect.as(workspaces.remove(workspace), { removed: workspace }),
          )
          .handle("snapshot", ({ params }) =>
            Effect.flatMap(workspaces.open(params.workspace), (ws) => ws.snapshot),
          )
          .handle("reorder_statuses", ({ params, payload }) =>
            Effect.flatMap(workspaces.open(params.workspace), (ws) => ws.reorderStatuses(payload)),
          )
          .handle("fix_all", ({ params }) =>
            Effect.flatMap(workspaces.open(params.workspace), (ws) => ws.fixAll),
          )
          // Raw, so that any content type is taken: the body is the file whatever it says it is.
          .handleRaw("upload_attachment", ({ params: { workspace, id, path } }) =>
            Effect.gen(function* () {
              const ws = yield* workspaces.open(workspace);
              const bytes = yield* uploadedBytes(path);
              return { path: yield* ws.writeAttachment(id, path, bytes) };
            }),
          )
          .handle("events", () =>
            Effect.succeed(
              Stream.merge(
                Stream.tick("25 seconds").pipe(Stream.as(ping)),
                workspaces.changes.pipe(
                  Stream.map((change) => ({ event: "change", data: change }) as const),
                ),
              ),
            ),
          )
      );
    }),
  );
