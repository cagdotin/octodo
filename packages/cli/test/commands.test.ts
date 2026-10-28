import { NodeServices } from "@effect/platform-node";
import { makeRegistry } from "@octodo/engine";
import { plugins } from "@octodo/plugins";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";
import { operationCommands } from "../src/commands.ts";

const registry = makeRegistry(plugins);

/** Runs the generated command `words` on `argv`, with every operation answering `[]`. */
const run = (words: ReadonlyArray<string>, argv: ReadonlyArray<string>) => {
  const { command } = operationCommands(registry, () => Effect.succeed([])).find(
    (each) => each.words.join(" ") === words.join(" "),
  )!;
  return Effect.runPromise(
    Command.runWith(command, { version: "0.0.0", renderErrors: false })(argv).pipe(
      Effect.andThen(TestConsole.logLines),
      Effect.provide(Layer.mergeAll(TestConsole.layer, NodeServices.layer)),
    ),
  );
};

describe("a generated command", () => {
  it("takes --json even when its result has no renderer, so a script can always pass it", async () => {
    for (const words of [
      ["counters", "history"],
      ["recurring", "history"],
    ])
      expect(await run(words, ["HM-1", "--json"])).toEqual(["[]"]);
  });
});
