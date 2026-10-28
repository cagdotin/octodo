import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/scan.ts";
import { initWorkspace } from "../src/workspace.ts";

const run = <A>(effect: Effect.Effect<A, unknown, any>, layer = NodeServices.layer) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A>);

const fresh = async (files: Record<string, string>) => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
    writeFileSync(join(root, ".octodo", file), content);
  }
  return root;
};

/** A file system whose reads of a path finish after a delay that the path picks, not the call order. */
const shuffledReads = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const late =
      <Args extends [string, ...Array<any>], A, E, R>(
        call: (...args: Args) => Effect.Effect<A, E, R>,
      ) =>
      (...args: Args) =>
        Effect.delay(call(...args), `${args[0].length % 7} millis`);
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
    const root = await fresh({
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
    });
    symlinkSync("/nonexistent", join(root, ".octodo/home/link"));

    const inOrder = await run(scanWorkspace("test", root));
    const shuffled = await run(scanWorkspace("test", root), shuffledReads);
    expect(
      inOrder.snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind]),
      "the diagnostics come in the order the scan judges the tree",
    ).toEqual([
      [".octodo/both", "both-markers"],
      [".octodo/garden/list.md", "invalid-frontmatter"],
      [".octodo/home/link", "symlink"],
      [".octodo/garden/HM-5-dig/task.md", "invalid-frontmatter"],
      [".octodo/garden/empty", "unmarked-folder"],
      [".octodo/HM-1-paint/task.md", "unknown-priority"],
      [".octodo/home/kitchen/copy/task.md", "duplicate-id"],
      [".octodo/HM-1-paint/HM-4-sand/task.md", "invalid-due"],
      [".octodo/notes.md", "note"],
      [".octodo/home/stray.md", "loose-markdown"],
      [".octodo/home/kitchen/HM-3-boxes/task.md", "unknown-status"],
      [".octodo/home/HM-2-pack/task.md", "broken-link"],
    ]);
    expect(shuffled.snapshot, "reads finishing out of order change nothing").toEqual(
      inOrder.snapshot,
    );
  });

  it("reports a task.md or list.md that is a link without reading its folder", async () => {
    const root = await fresh({});
    const target = (name: string) => join(dirname(root), name);
    writeFileSync(target("task.md"), "---\nid: HM-1\ntitle: Linked\n---\n");
    writeFileSync(target("list.md"), "---\nname: Linked\n---\n");
    mkdirSync(join(root, ".octodo/HM-1-linked"));
    symlinkSync(target("task.md"), join(root, ".octodo/HM-1-linked/task.md"));
    mkdirSync(join(root, ".octodo/garden/HM-2-dig"), { recursive: true });
    symlinkSync(target("list.md"), join(root, ".octodo/garden/list.md"));
    writeFileSync(join(root, ".octodo/garden/HM-2-dig/task.md"), "---\nid: HM-2\n---\n");

    const scan = await run(scanWorkspace("test", root));
    expect(scan.snapshot.tasks).toEqual([]);
    expect(scan.snapshot.lists).toEqual([]);
    expect(
      scan.snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind]),
    ).toEqual([
      [".octodo/HM-1-linked/task.md", "symlink"],
      [".octodo/garden/list.md", "symlink"],
    ]);
    expect(scan.nextIdNumber, "the ids in the folders it does not read are still taken").toBe(3);
  });

  it("reports a folder it can list but not enter as unreadable, in a list and in a task", async () => {
    const root = await fresh({ "HM-1-a/task.md": "---\nid: HM-1\n---\n" });
    const locked = [join(root, ".octodo/noexec"), join(root, ".octodo/HM-1-a/images")];
    for (const dir of locked) {
      mkdirSync(join(dir, "inner"), { recursive: true });
      chmodSync(dir, 0o644);
    }
    try {
      const { snapshot } = await run(scanWorkspace("test", root));
      expect(snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind])).toEqual([
        [".octodo/noexec", "unreadable"],
        [".octodo/HM-1-a/images", "unreadable"],
      ]);
    } finally {
      for (const dir of locked) chmodSync(dir, 0o755);
    }
  });

  it("only reads: a task.md without an id is reported and left as it is", async () => {
    const root = await fresh({ "garden/list.md": "---\nname: Garden\n---\n" });
    const file = join(root, ".octodo/garden/weeds/task.md");
    mkdirSync(dirname(file));
    writeFileSync(file, "Pull the weeds\n");
    const refuseWrites = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const refused = () => Effect.die(new Error("the scan wrote"));
        return {
          ...fs,
          makeDirectory: refused,
          remove: refused,
          rename: refused,
          writeFile: refused,
          writeFileString: refused,
        };
      }),
    ).pipe(Layer.provideMerge(NodeServices.layer));

    const { snapshot, missingId } = await run(scanWorkspace("test", root), refuseWrites);
    expect(missingId).toEqual([dirname(file)]);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["missing-id"]);
    expect(readFileSync(file, "utf8")).toBe("Pull the weeds\n");
  });
});
