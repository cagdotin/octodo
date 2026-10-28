import { Effect } from "effect";
import { invalid, storageError, type State } from "../state.ts";

/**
 * Adds `plugin` to config.json's `plugins` or takes it out, and gives the plugins the workspace
 * enables then. Enabling refuses a plugin octodo does not have; disabling takes out any id
 * config.json lists, so a stale one can be removed.
 */
export const setPluginEnabled = (state: State, plugin: string, enabled: boolean) =>
  state.write((files) =>
    Effect.gen(function* () {
      const installed = state.plugins.some((candidate) => candidate.shared.id === plugin);
      let listed = false;
      yield* files
        .editConfig((config) => {
          const current = config.plugins ?? [];
          listed = current.includes(plugin);
          if (listed === enabled || (enabled && !installed)) return null;
          return {
            plugins: enabled ? [...current, plugin] : current.filter((id) => id !== plugin),
          };
        })
        .pipe(storageError("Could not change the workspace's plugins"));
      if (!installed && (enabled || !listed))
        return yield* invalid(`octodo has no plugin ${plugin}; list_plugins lists the ones it has`);
      return (yield* state.scan).snapshot.plugins ?? [];
    }),
  );
