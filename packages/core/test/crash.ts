import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { basename } from "node:path";
import { makeWorkspace } from "../src/workspace.ts";

/**
 * Run as `node crash.ts <root> create|read`: creates a task in, or reads, the workspace at
 * <root>, and kills this process at the first rename that publishes a hidden name under a visible
 * one, as a crash would, before any cleanup runs.
 */
const [root, operation] = process.argv.slice(2);

const crashing = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      ...fs,
      rename: (from, to) =>
        basename(from).startsWith(".") && !basename(to).startsWith(".")
          ? Effect.sync(() => process.kill(process.pid, "SIGKILL"))
          : fs.rename(from, to),
    };
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

await Effect.runPromise(
  Effect.gen(function* () {
    const workspace = yield* makeWorkspace("crash", root!);
    if (operation === "create") yield* workspace.createTask({ title: "Crashed" });
    else yield* workspace.snapshot;
  }).pipe(Effect.scoped, Effect.provide(crashing)),
);
