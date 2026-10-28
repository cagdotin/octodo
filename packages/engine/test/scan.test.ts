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
import { makeStorage } from "../src/storage/storage.ts";
import { initWorkspace } from "../src/workspace.ts";

const run = <A>(effect: Effect.Effect<A, unknown, any>, layer = NodeServices.layer) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A>);

const fresh = async (files: Record<string, string>) => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, ".octodo/tasks", file)), { recursive: true });
    writeFileSync(join(root, ".octodo/tasks", file), content);
  }
  return root;
};

const scan = (root: string) =>
  Effect.flatMap(makeStorage(root), (storage) =>
    Effect.map(storage.read, (read) => scanWorkspace("test", root, read)),
  );

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
    symlinkSync("/nonexistent", join(root, ".octodo/tasks/home/link"));

    const inOrder = await run(scan(root));
    const shuffled = await run(scan(root), shuffledReads);
    expect(
      inOrder.snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind]),
      "the diagnostics come in the order the scan judges the tree",
    ).toEqual([
      [".octodo/tasks/both", "both-markers"],
      [".octodo/tasks/garden/list.md", "invalid-frontmatter"],
      [".octodo/tasks/home/link", "symlink"],
      [".octodo/tasks/garden/HM-5-dig/task.md", "invalid-frontmatter"],
      [".octodo/tasks/garden/empty", "unmarked-folder"],
      [".octodo/tasks/HM-1-paint/task.md", "unknown-priority"],
      [".octodo/tasks/home/kitchen/copy/task.md", "duplicate-id"],
      [".octodo/tasks/HM-1-paint/HM-4-sand/task.md", "invalid-due"],
      [".octodo/tasks/notes.md", "note"],
      [".octodo/tasks/home/stray.md", "loose-markdown"],
      [".octodo/tasks/home/kitchen/HM-3-boxes/task.md", "unknown-status"],
      [".octodo/tasks/home/HM-2-pack/task.md", "broken-link"],
    ]);
    expect(shuffled.snapshot, "reads finishing out of order change nothing").toEqual(
      inOrder.snapshot,
    );
  });

  it("reads only config.json and sections at the top of .octodo/, and takes the ids of the rest", async () => {
    const root = await fresh({
      "HM-1-pack/task.md": "---\nid: HM-1\nblocked_by: [HM-12]\n---\n",
    });
    const top = (file: string, content: string) => {
      mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
      writeFileSync(join(root, ".octodo", file), content);
    };
    top("HM-12-old/task.md", "---\nid: HM-12\n---\n");
    top("readme.md", "---\nid: HM-20\n---\n");
    top("notes.txt", "words\n");
    symlinkSync("/nonexistent", join(root, ".octodo/linked"));

    const { snapshot, nextIdNumber } = await run(scan(root));
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["HM-1"]);
    expect(snapshot.tasks[0]!.blocked, "a blocker that is not read still blocks").toBe(true);
    expect(snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind])).toEqual([
      [".octodo/HM-12-old", "misplaced"],
      [".octodo/linked", "symlink"],
      [".octodo/notes.txt", "misplaced"],
      [".octodo/readme.md", "misplaced"],
    ]);
    expect(nextIdNumber, "ids in what is not read are never handed out again").toBe(21);
  });

  it("reports a task.md or list.md that is a link without reading its folder", async () => {
    const root = await fresh({});
    const target = (name: string) => join(dirname(root), name);
    writeFileSync(target("task.md"), "---\nid: HM-1\ntitle: Linked\n---\n");
    writeFileSync(target("list.md"), "---\nname: Linked\n---\n");
    mkdirSync(join(root, ".octodo/tasks/HM-1-linked"));
    symlinkSync(target("task.md"), join(root, ".octodo/tasks/HM-1-linked/task.md"));
    mkdirSync(join(root, ".octodo/tasks/garden/HM-2-dig"), { recursive: true });
    symlinkSync(target("list.md"), join(root, ".octodo/tasks/garden/list.md"));
    writeFileSync(join(root, ".octodo/tasks/garden/HM-2-dig/task.md"), "---\nid: HM-2\n---\n");

    const scanned = await run(scan(root));
    expect(scanned.snapshot.tasks).toEqual([]);
    expect(scanned.snapshot.lists).toEqual([]);
    expect(
      scanned.snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind]),
    ).toEqual([
      [".octodo/tasks/HM-1-linked/task.md", "symlink"],
      [".octodo/tasks/garden/list.md", "symlink"],
    ]);
    expect(scanned.nextIdNumber, "the ids in the folders it does not read are still taken").toBe(3);
  });

  it("reports a folder it can list but not enter as unreadable, in a list and in a task", async () => {
    const root = await fresh({ "HM-1-a/task.md": "---\nid: HM-1\n---\n" });
    const locked = [join(root, ".octodo/tasks/noexec"), join(root, ".octodo/tasks/HM-1-a/images")];
    for (const dir of locked) {
      mkdirSync(join(dir, "inner"), { recursive: true });
      chmodSync(dir, 0o644);
    }
    try {
      const { snapshot } = await run(scan(root));
      expect(snapshot.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.kind])).toEqual([
        [".octodo/tasks/noexec", "unreadable"],
        [".octodo/tasks/HM-1-a/images", "unreadable"],
      ]);
    } finally {
      for (const dir of locked) chmodSync(dir, 0o755);
    }
  });

  it("only reads: a task.md without an id is reported and left as it is", async () => {
    const root = await fresh({ "garden/list.md": "---\nname: Garden\n---\n" });
    const file = join(root, ".octodo/tasks/garden/weeds/task.md");
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

    const { snapshot, missingId } = await run(scan(root), refuseWrites);
    expect(missingId).toEqual([dirname(file)]);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["missing-id"]);
    expect(readFileSync(file, "utf8")).toBe("Pull the weeds\n");
  });
});
