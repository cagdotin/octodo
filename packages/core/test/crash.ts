import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { basename } from "node:path";
import { makeWorkspace } from "../src/workspace.ts";

/**
 * Run as `node crash.ts <root> <operation> <at-publish>`, another octodo process on the workspace
 * at <root>. <operation> is `create` (one task), `create:<n>` (n tasks one after another) or
 * `read`. At the first rename that publishes a hidden name under a visible one, while it holds the
 * owner lock, <at-publish> decides: `kill` sends this process SIGKILL, as a crash would; `pause`
 * prints "paused" and waits for a line on stdin; `go` carries on. It prints the ids it created.
 */
const [root, operation, atPublish] = process.argv.slice(2);

const stdinLine = () => new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));

let published = false;
const publishing = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      ...fs,
      rename: (from, to) => {
        if (published || !basename(from).startsWith(".") || basename(to).startsWith("."))
          return fs.rename(from, to);
        published = true;
        if (atPublish === "kill") return Effect.sync(() => process.kill(process.pid, "SIGKILL"));
        if (atPublish === "pause")
          return Effect.andThen(
            Effect.promise(() => {
              process.stdout.write("paused\n");
              return stdinLine();
            }),
            fs.rename(from, to),
          );
        return fs.rename(from, to);
      },
    };
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

await Effect.runPromise(
  Effect.gen(function* () {
    const workspace = yield* makeWorkspace("crash", root!);
    if (operation === "read") return yield* workspace.snapshot;
    const count = Number(operation!.split(":")[1] ?? 1);
    for (let index = 0; index < count; index++) {
      const task = yield* workspace.createTask({ title: `Task ${process.pid} ${index}` });
      process.stdout.write(`${task.id}\n`);
    }
  }).pipe(Effect.scoped, Effect.provide(publishing)),
);
process.exit(0);
