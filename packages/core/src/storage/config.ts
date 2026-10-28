import { Effect, FileSystem, Path, Schema } from "effect";
import { WorkspaceConfig } from "../domain.ts";
import { CONFIG_FILE, TASKS_DIR, deriveKey, humanize } from "../layout.ts";

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkspaceConfig));

/** What a workspace runs on, and why config.json could not give it when `problem` is set. */
export interface ConfigRead {
  readonly config: WorkspaceConfig;
  /** Why config.json is unusable; `config` is then the folder-name fallback. */
  readonly problem: string | null;
}

const configFile = (path: Path.Path, root: string) => path.join(root, TASKS_DIR, CONFIG_FILE);

/** Never fails: a missing, unreadable or invalid config.json reads as the folder-name fallback. */
export const readConfig = (
  root: string,
): Effect.Effect<ConfigRead, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(configFile(path, root)).pipe(
      Effect.flatMap(decodeConfig),
      Effect.map((config): ConfigRead => ({ config, problem: null })),
      Effect.catch((error) => {
        const name = humanize(path.basename(root));
        return Effect.succeed<ConfigRead>({
          config: { name, key: deriveKey(name) },
          problem: String(error),
        });
      }),
    );
  });
