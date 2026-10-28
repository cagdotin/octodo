import { Workspaces, type Registry } from "@octodo/engine";
import { Effect } from "effect";
import type { Backend, ClientError } from "./backend.ts";

/** The operations and endpoints on the engine in this process, as the server runs them. */
export const embeddedBackend = (
  workspaces: Workspaces["Service"],
  registry: Registry,
): Backend => ({
  run: (name, _operation, input) =>
    registry
      .run(name, input, (workspace) => workspaces.open(workspace!))
      .pipe(
        Effect.provideService(Workspaces, workspaces),
        Effect.mapError((error) => error as ClientError),
      ),
  removeWorkspace: (id) => workspaces.remove(id),
  fixAll: (workspace) => Effect.flatMap(workspaces.open(workspace), (ws) => ws.fixAll),
});
