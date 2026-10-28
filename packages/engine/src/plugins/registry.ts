import { PluginNotEnabled } from "@octodo/contract";
import type { Operation, OperationName } from "@octodo/contract/catalog";
import { Effect, Schema } from "effect";
import { runOperation } from "../operations.ts";
import type { Workspace } from "../workspace.ts";
import type { Workspaces } from "../workspaces.ts";
import { checkPlugins, plainTask, type Plugin, type PluginWorkspace } from "./plugin.ts";

/** Every operation octodo offers with the plugins it has, and the one way to run any of them. */
export interface Registry {
  readonly plugins: ReadonlyArray<Plugin>;
  /**
   * The plain task's catalog, then each plugin's operations, each able to fail with
   * `PluginNotEnabled` as well. Surfaces list them all, whatever a workspace enables.
   */
  readonly operations: Readonly<Record<string, Operation>>;
  /**
   * Runs the operation `name` on a decoded `input`, as `runOperation` does. A plugin's operation
   * fails with `PluginNotEnabled` in a workspace whose config.json does not enable the plugin.
   */
  readonly run: <E, R>(
    name: string,
    input: unknown,
    open: (workspace: string | undefined) => Effect.Effect<Workspace, E, R>,
  ) => Effect.Effect<unknown, E | { readonly message: string }, Workspaces | R>;
}

/** The workspace a plugin's handler gets: its writes are bound to the plugin's own kind. */
const forPlugin = (workspace: Workspace, plugin: string): PluginWorkspace => ({
  ...workspace,
  createOfKind: (input, keys) => workspace.createTask(input, { id: plugin, keys }),
  editOfKind: (taskId, change) => workspace.editKind(plugin, taskId, change),
});

/** The plain task and `plugins` as one set of operations. Throws on what `checkPlugins` refuses. */
export const makeRegistry = (plugins: ReadonlyArray<Plugin>): Registry => {
  checkPlugins(plugins);
  const owners = new Map(
    plugins.flatMap((plugin) =>
      Object.keys(plugin.shared.operations).map((name) => [name, plugin] as const),
    ),
  );
  const operations: Record<string, Operation> = { ...plainTask.operations };
  for (const [name, plugin] of owners) {
    const operation = plugin.shared.operations[name]!;
    operations[name] = { ...operation, error: Schema.Union([operation.error, PluginNotEnabled]) };
  }

  const run: Registry["run"] = (name, input, open) => {
    const plugin = owners.get(name);
    if (plugin === undefined) return runOperation(name as OperationName, input as never, open);
    const { workspace, ...rest } = input as { readonly workspace?: string };
    return Effect.gen(function* () {
      const ws = yield* open(workspace);
      const { plugins: enabled = [] } = yield* ws.snapshot;
      if (!enabled.includes(plugin.shared.id))
        return yield* new PluginNotEnabled({ plugin: plugin.shared.id, workspace: ws.root });
      return yield* plugin.handlers[name]!(forPlugin(ws, plugin.shared.id), rest) as Effect.Effect<
        unknown,
        { readonly message: string }
      >;
    });
  };

  return { plugins, operations, run };
};
