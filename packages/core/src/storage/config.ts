import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import type { Problem } from "../diagnostics.ts";
import { WorkspaceConfig } from "../domain.ts";
import { CONFIG_FILE, TASKS_DIR, deriveKey, humanize, isWorkspaceKey } from "../layout.ts";

const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeConfig = Schema.decodeUnknownEffect(WorkspaceConfig);

type Platform = FileSystem.FileSystem | Path.Path;

/** What a workspace runs on, and what is wrong with config.json. */
export interface ConfigRead {
  readonly config: WorkspaceConfig;
  /** Whether config.json is unusable, so `config` is the folder-name fallback. */
  readonly fallback: boolean;
  readonly problems: ReadonlyArray<Problem>;
}

export const configFile = (path: Path.Path, root: string): string =>
  path.join(root, TASKS_DIR, CONFIG_FILE);

/** config.json's text for `document`. */
export const configText = (document: object): string => `${JSON.stringify(document, null, 2)}\n`;

/** The whole JSON object, unknown keys included, and the part of it octodo reads. */
const readDocument = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = configFile(path, root);
    const document = yield* decodeDocument(yield* fs.readFileString(file));
    return { document, config: yield* decodeConfig(document) };
  });

/** A key that ids and mentions such as `[[HM-1]]` cannot be read with. */
const keyProblem = ({ key, name }: WorkspaceConfig): Problem => {
  const usable = key.replace(/[^A-Za-z0-9]/g, "");
  const suggested = isWorkspaceKey(usable) ? usable : deriveKey(name);
  return {
    kind: "invalid-config",
    field: "key",
    detail: `The key ${JSON.stringify(key)} is not letters and digits starting with a letter, so a mention such as [[${key}-1]] is not read. Its tasks still load; to fix it, set "key" in config.json to letters and digits such as "${suggested}" and change each id ${key}-<n> to ${suggested}-<n>`,
  };
};

/** Never fails: a missing, unreadable or invalid config.json reads as the folder-name fallback. */
export const readConfig = (root: string): Effect.Effect<ConfigRead, never, Platform> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fallback = (error: unknown): ConfigRead => {
      const name = humanize(path.basename(root));
      const unusable: Problem = {
        kind: "invalid-config",
        field: null,
        detail: `${String(error)}; until it is fixed the workspace uses its folder name and the default statuses`,
      };
      return { config: { name, key: deriveKey(name) }, fallback: true, problems: [unusable] };
    };
    return yield* readDocument(root).pipe(
      Effect.map(({ config }): ConfigRead => ({
        config,
        fallback: false,
        problems: isWorkspaceKey(config.key) ? [] : [keyProblem(config)],
      })),
      Effect.catch((error) => Effect.succeed(fallback(error))),
    );
  });

/** Whether `root` holds a workspace: a `.octodo/config.json`, readable or not. */
export const hasConfig = (
  root: string,
): Effect.Effect<boolean, PlatformError.PlatformError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(configFile(yield* Path.Path, root));
  });

/**
 * config.json's text with the keys `edit` returns set and every other key, unknown ones included,
 * kept in its place; null when `edit` returns null. Fails on a config.json that does not read.
 */
export const editedConfig = (
  root: string,
  edit: (config: WorkspaceConfig) => Partial<WorkspaceConfig> | null,
) =>
  Effect.gen(function* () {
    const { document, config } = yield* readDocument(root);
    const changes = edit(config);
    return changes === null ? null : configText({ ...document, ...changes });
  });
