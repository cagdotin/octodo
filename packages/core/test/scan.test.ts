import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/scan.ts";
import { initWorkspace } from "../src/workspace.ts";

const run = <A>(effect: Effect.Effect<A, unknown, any>, layer = NodeServices.layer) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A>);

/** A file system whose reads of `path` finish after a delay that the path picks, not the call order. */
const shuffledReads = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const late =
      <Args extends [string, ...Array<any>], A, E, R>(
        call: (...args: Args) => Effect.Effect<A, E, R>,
      ) =>
      (...args: Args) => {
        const delay = args[0].length % 7;
        return Effect.delay(call(...args), `${delay} millis`);
      };
    return {
      ...fs,
      readDirectory: late(fs.readDirectory),
      readFile: late(fs.readFile),
      readFileString: late(fs.readFileString),
      lstat: late(fs.lstat),
      stat: late(fs.stat),
    };
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("scanWorkspace", () => {
  it("reads the same snapshot, diagnostics in the same order, whatever order its reads finish in", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
    mkdirSync(root);
    await run(initWorkspace(root));
    const files: Record<string, string> = {
      "home/list.md": "---\nname: Home\norder: a1\n---\n",
      "home/kitchen/list.md": "---\nname: Kitchen\norder: a0\n---\n",
      "garden/list.md": "---\nname: [broken\n---\n",
      "HM-1-paint/task.md": "---\nid: HM-1\ntitle: Paint\npriority: loud\n---\nSee [[HM-2]]\n",
      "HM-1-paint/HM-4-sand/task.md": "---\nid: HM-4\ntitle: Sand\ndue: soon\n---\n",
      "HM-1-paint/plan.png": "png",
      "home/HM-2-pack/task.md": "---\nid: HM-2\ntitle: Pack\nblocked_by: [HM-9]\n---\n",
      "home/kitchen/HM-3-boxes/task.md": "---\nid: HM-3\ntitle: Boxes\nstatus: odd\n---\n",
      "home/kitchen/copy/task.md": "---\nid: HM-3\ntitle: Boxes\n---\n",
      "home/stray.md": "---\nid: HM-7\n---\n",
      "notes.md": "just words\n",
      "garden/HM-5-dig/task.md": "---\nid: HM-5\ntitle: [oops\n---\n",
      "garden/empty/readme.txt": "nothing here\n",
      "both/task.md": "---\nid: HM-6\n---\n",
      "both/list.md": "---\nname: Both\n---\n",
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
      writeFileSync(join(root, ".octodo", file), content);
    }
    symlinkSync("/nonexistent", join(root, ".octodo/home/link"));

    const inOrder = await run(scanWorkspace("test", root));
    const shuffled = await run(scanWorkspace("test", root), shuffledReads);
    expect(
      inOrder.snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind]),
      "folders are judged in name order, lists before the tasks they hold, links last",
    ).toEqual([
      [".octodo/both", "both-markers"],
      [".octodo/garden/list.md", "invalid-frontmatter"],
      [".octodo/home/link", "symlink"],
      [".octodo/garden/HM-5-dig/task.md", "invalid-frontmatter"],
      [".octodo/garden/empty", "unmarked-folder"],
      [".octodo/HM-1-paint/task.md", "unknown-priority"],
      [".octodo/HM-1-paint/HM-4-sand/task.md", "invalid-due"],
      [".octodo/home/kitchen/copy/task.md", "duplicate-id"],
      [".octodo/notes.md", "note"],
      [".octodo/home/stray.md", "loose-markdown"],
      [".octodo/home/kitchen/HM-3-boxes/task.md", "unknown-status"],
      [".octodo/home/HM-2-pack/task.md", "broken-link"],
    ]);
    expect(shuffled.snapshot, "reads finishing out of order change nothing").toEqual(
      inOrder.snapshot,
    );
  });
});
