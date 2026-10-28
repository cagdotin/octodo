import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Workspaces } from "@octodo/engine";
import { Console, Effect } from "effect";
import { Command } from "effect/cli";
import { home, octo } from "./octo.ts";

const fail = (message: string) =>
  Effect.andThen(
    Console.error(message),
    Effect.sync(() => (process.exitCode = 1)),
  );

octo.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.catchTags({
    TaskNotFound: (error) => fail(error.message),
    WorkspaceNotFound: (error) => fail(`${error.message}. Run \`octo init\` or pass --workspace.`),
    InvalidRequest: (error) => fail(error.message),
    AttachmentNotFound: (error) => fail(error.message),
    AttachmentTooLarge: (error) => fail(error.message),
    StorageError: (error) => fail(`${error.message}: ${String(error.cause)}`),
    PlatformError: (error) => fail(error.message),
  }),
  Effect.provide(Workspaces.layer({ home, watch: false })),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
