import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Connection } from "@octodo/client";
import { VERSION } from "@octodo/contract/api";
import { Console, Effect } from "effect";
import { Command } from "effect/cli";
import { home, octo, registry } from "./octo.ts";

const fail = (message: string) =>
  Effect.andThen(
    Console.error(message),
    Effect.sync(() => (process.exitCode = 1)),
  );

octo.pipe(
  Command.run({ version: VERSION }),
  Effect.catchTags({
    TaskNotFound: (error) => fail(error.message),
    EntryNotFound: (error) => fail(error.message),
    WorkspaceNotFound: (error) => fail(`${error.message}. Run \`octo init\` or pass --workspace.`),
    InvalidRequest: (error) => fail(error.message),
    AttachmentNotFound: (error) => fail(error.message),
    AttachmentTooLarge: (error) => fail(error.message),
    PluginNotEnabled: (error) => fail(error.message),
    ServerMismatch: (error) => fail(error.message),
    ServerUnavailable: (error) => fail(error.message),
    StorageError: (error) => fail(`${error.message}: ${String(error.cause)}`),
    PlatformError: (error) => fail(error.message),
  }),
  Effect.provide(Connection.layer({ home, registry, watch: false })),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
