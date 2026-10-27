import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, FileSystem, Layer } from "effect";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateWorkspace } from "../src/migrate.ts";
import { initWorkspace, makeWorkspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>, layer = NodeServices.layer) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E>);

/** A file system that dies on the `limit`-th write, rename or removal, like a process killed there. */
const crashingAt = (limit: number) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let count = 0;
      const guard = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.suspend(() => (count++ >= limit ? Effect.die("crash") : effect));
      return {
        ...fs,
        makeDirectory: (...args: Parameters<typeof fs.makeDirectory>) =>
          guard(fs.makeDirectory(...args)),
        writeFile: (...args: Parameters<typeof fs.writeFile>) => guard(fs.writeFile(...args)),
        writeFileString: (...args: Parameters<typeof fs.writeFileString>) =>
          guard(fs.writeFileString(...args)),
        rename: (...args: Parameters<typeof fs.rename>) => guard(fs.rename(...args)),
        remove: (...args: Parameters<typeof fs.remove>) => guard(fs.remove(...args)),
      } satisfies FileSystem.FileSystem;
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

const OLD_LAYOUT: Record<string, string> = {
  "s00-backlog/.DS_Store": "",
  "s01-todo/HM-1-buy-milk.md":
    "---\nid: HM-1\ntitle: Buy milk\npriority: none\ntags: []\n# kept\nestimate: 3\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-02T00:00:00.000Z\norder: a0\n---\n\nOat, please.\n",
  "s03-done/HM-2-call-plumber.md": "---\nid: HM-2\ntitle: Call plumber\npriority: high\n---\n",
  "l01-home/s01-todo/HM-3-paint.md": "---\nid: HM-3\ntitle: Paint\n---\n",
  "l01-home/l00-kitchen/s02-in-progress/HM-4-tiles.md": "---\nid: HM-4\ntitle: Tiles\n---\n",
  "l00-garden/s01-todo/HM-5-seeds.md": "---\nid: HM-5\ntitle: Seeds\ntags: [spring]\n---\n",
  "l-attic/s04-archived/notes.md": "Boxes\n",
};

const oldWorkspace = async () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-migrate-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  for (const [file, content] of Object.entries(OLD_LAYOUT)) {
    mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
    writeFileSync(join(root, ".octodo", file), content);
  }
  return root;
};

/** Every visible file under `.octodo/` with its content; hidden leftovers are ignored by readers. */
const tree = (root: string) =>
  Object.fromEntries(
    readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" })
      .filter((entry) => !entry.split("/").some((part) => part.startsWith(".")))
      .filter((entry) => statSync(join(root, ".octodo", entry)).isFile())
      .toSorted()
      .map((entry) => [entry, readFileSync(join(root, ".octodo", entry), "utf8")]),
  );

describe("migrateWorkspace", () => {
  it("turns task files into task folders and numbered lists into lists with list.md", async () => {
    const root = await oldWorkspace();
    const summary = await run(migrateWorkspace(root));
    expect(summary).toEqual({ tasks: 6, lists: 4, statusFolders: 7, skipped: [] });
    const files = tree(root);
    expect(Object.keys(files)).toEqual([
      "HM-1-buy-milk/task.md",
      "HM-2-call-plumber/task.md",
      "attic/list.md",
      "attic/notes/task.md",
      "config.json",
      "garden/HM-5-seeds/task.md",
      "garden/list.md",
      "home/HM-3-paint/task.md",
      "home/kitchen/HM-4-tiles/task.md",
      "home/kitchen/list.md",
      "home/list.md",
    ]);
    expect(files["HM-1-buy-milk/task.md"]).toBe(
      "---\nid: HM-1\ntitle: Buy milk\n# kept\nestimate: 3\ncreated: 2026-01-01T00:00:00.000Z\norder: a0\nstatus: todo\n---\n\nOat, please.\n",
    );
    expect(files["home/list.md"]).toBe("---\nname: Home\norder: a1\n---\n");
    expect(files["attic/list.md"]).toBe("---\nname: Attic\n---\n");

    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.lists.map((list) => list.id)).toEqual([
      "garden",
      "home",
      "home/kitchen",
      "attic",
    ]);
    expect(
      Object.fromEntries(snapshot.tasks.map((task) => [task.id, [task.status, task.list]])),
    ).toEqual({
      "HM-1": ["todo", null],
      "HM-2": ["done", null],
      "HM-3": ["todo", "home"],
      "HM-4": ["in-progress", "home/kitchen"],
      "HM-5": ["todo", "garden"],
      "HM-6": ["archived", "attic"],
    });
  });

  it("changes nothing when run a second time", async () => {
    const root = await oldWorkspace();
    await run(migrateWorkspace(root));
    const before = tree(root);
    const second = await run(migrateWorkspace(root));
    expect(second).toEqual({ tasks: 0, lists: 0, statusFolders: 0, skipped: [] });
    expect(tree(root)).toEqual(before);
  });

  it("finishes the job when rerun after a crash at any step", async () => {
    const reference = await oldWorkspace();
    await run(migrateWorkspace(reference));
    const expected = tree(reference);
    let crashes = 0;
    for (let limit = 0; ; limit++) {
      const root = await oldWorkspace();
      const exit = await Effect.runPromiseExit(
        migrateWorkspace(root).pipe(Effect.provide(crashingAt(limit))),
      );
      if (Exit.isSuccess(exit)) break;
      crashes++;
      await run(migrateWorkspace(root));
      expect(tree(root), `crash at step ${limit}`).toEqual(expected);
    }
    expect(crashes).toBeGreaterThan(20);
  });

  it("leaves folders of the new layout alone, whatever their names", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "octodo-migrate-")), "house-move");
    mkdirSync(root);
    await run(
      Effect.gen(function* () {
        yield* initWorkspace(root);
        const ws = yield* makeWorkspace("test", root);
        const desk = yield* ws.createList({ name: "L-shaped desk" });
        yield* ws.createTask({ title: "Measure", list: desk.id });
        yield* ws.createList({ name: "S1 tier" });
      }),
    );
    mkdirSync(join(root, ".octodo/s-tier"));
    writeFileSync(join(root, ".octodo/s-tier/readme.txt"), "not a status");
    const before = tree(root);
    const summary = await run(migrateWorkspace(root));
    expect(summary).toEqual({ tasks: 0, lists: 0, statusFolders: 0, skipped: [] });
    expect(tree(root)).toEqual(before);
  });

  it("keeps what it cannot convert and says why", async () => {
    const root = await oldWorkspace();
    writeFileSync(join(root, ".octodo/s03-done/receipt.pdf"), "pdf");
    writeFileSync(join(root, ".octodo/s01-todo/broken.md"), "---\nid: [oops\n---\n");
    const summary = await run(migrateWorkspace(root));
    expect(summary.skipped.map((entry) => entry.path)).toEqual([
      ".octodo/s01-todo/broken.md",
      ".octodo/s01-todo",
      ".octodo/s03-done",
    ]);
    expect(readdirSync(join(root, ".octodo/s03-done"))).toEqual(["receipt.pdf"]);
  });
});
