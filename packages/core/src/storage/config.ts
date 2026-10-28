import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { WorkspaceConfig } from "../domain.ts";
import { writeFileAtomic } from "../files.ts";
import { CONFIG_FILE, TASKS_DIR, deriveKey, humanize } from "../layout.ts";

const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeConfig = Schema.decodeUnknownEffect(WorkspaceConfig);

type Platform = FileSystem.FileSystem | Path.Path;

/** What a workspace runs on, and why config.json could not give it when `problem` is set. */
export interface ConfigRead {
  readonly config: WorkspaceConfig;
  /** Why config.json is unusable; `config` is then the folder-name fallback. */
  readonly problem: string | null;
}

const configFile = (path: Path.Path, root: string) => path.join(root, TASKS_DIR, CONFIG_FILE);

const serialize = (document: object) => `${JSON.stringify(document, null, 2)}\n`;

/** The whole JSON object, unknown keys included, and the part of it octodo reads. */
const readDocument = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = configFile(path, root);
    const document = yield* decodeDocument(yield* fs.readFileString(file));
    return { file, document, config: yield* decodeConfig(document) };
  });

/** Never fails: a missing, unreadable or invalid config.json reads as the folder-name fallback. */
export const readConfig = (root: string): Effect.Effect<ConfigRead, never, Platform> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fallback = (error: unknown): ConfigRead => {
      const name = humanize(path.basename(root));
      return { config: { name, key: deriveKey(name) }, problem: String(error) };
    };
    return yield* readDocument(root).pipe(
      Effect.map(({ config }): ConfigRead => ({ config, problem: null })),
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

/** Writes a new workspace's config.json into its existing `.octodo/` folder. */
export const createConfig = (root: string, config: WorkspaceConfig) =>
  Effect.gen(function* () {
    yield* writeFileAtomic(configFile(yield* Path.Path, root), serialize(config));
  });

/**
 * Sets the keys `edit` returns and keeps every other key, unknown ones included, in its place.
 * Fails on a config.json that does not read, so a broken file is reported, never rewritten.
 * Writes nothing when `edit` returns null.
 */
export const editConfig = (
  root: string,
  edit: (config: WorkspaceConfig) => Partial<WorkspaceConfig> | null,
) =>
  Effect.gen(function* () {
    const { file, document, config } = yield* readDocument(root);
    const changes = edit(config);
    if (changes !== null) yield* writeFileAtomic(file, serialize({ ...document, ...changes }));
  });
