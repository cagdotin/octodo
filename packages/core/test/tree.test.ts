import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CALLS_AT_ONCE, makeTreeReader } from "../src/storage/tree.ts";

/** A `.octodo/` with `count` tasks, half of them in a list, each with a subtask. */
const workspace = (count: number) => {
  const tasksDir = join(mkdtempSync(join(tmpdir(), "octodo-")), ".octodo");
  mkdirSync(join(tasksDir, "garden"), { recursive: true });
  writeFileSync(join(tasksDir, "garden/list.md"), "---\nname: Garden\n---\n");
  for (let n = 1; n <= count; n++) {
    const dir = join(tasksDir, n % 2 === 0 ? "garden" : "", `HM-${n}`, `HM-${n + count}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "..", "task.md"), `---\nid: HM-${n}\n---\n`);
    writeFileSync(join(dir, "task.md"), `---\nid: HM-${n + count}\n---\n`);
    writeFileSync(join(dir, "..", "notes.md"), "notes\n");
  }
  return tasksDir;
};

/** A file system that counts the calls in flight, each taking a millisecond or two. */
const counting = () => {
  const counts = { now: 0, most: 0 };
  const layer = Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const counted =
        <Args extends Array<any>, A, E, R>(call: (...args: Args) => Effect.Effect<A, E, R>) =>
        (...args: Args) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              counts.most = Math.max(counts.most, ++counts.now);
            }),
            () => Effect.delay(call(...args), `${1 + (counts.now % 2)} millis`),
            () => Effect.sync(() => counts.now--),
          );
      return {
        ...fs,
        exists: counted(fs.exists),
        lstat: counted(fs.lstat),
        readDirectory: counted(fs.readDirectory),
        readFileString: counted(fs.readFileString),
        readLink: counted(fs.readLink),
        stat: counted(fs.stat),
      };
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return { counts, layer };
};

describe("the tree reader", () => {
  it(
    `keeps at most ${CALLS_AT_ONCE} file system calls in flight, across reads of several workspaces`,
    { timeout: 30_000 },
    async () => {
      const [a, b] = [workspace(150), workspace(150)];
      const { counts, layer } = counting();
      const [treeA, treeB] = await Effect.runPromise(
        Effect.all([makeTreeReader().read(a), makeTreeReader().read(b)], {
          concurrency: "unbounded",
        }).pipe(Effect.provide(layer)),
      );
      expect(counts.most, "the reads fill the cap, so it is what limits them").toBe(CALLS_AT_ONCE);
      for (const tree of [treeA, treeB])
        expect(
          tree.children._tag === "Success" ? tree.children.success.length : 0,
          "each read sees the list, its 75 top-level tasks and nothing else",
        ).toBe(76);
    },
  );
});
