import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace, makeWorkspace, type Workspace } from "../src/workspace.ts";

/** Each call is its own runtime, as another process would be: nothing is shared but the files. */
const run = <A, E>(effect: Effect.Effect<A, E, any>, layer = NodeServices.layer) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E>);

/**
 * A file system that sees `.octodo/` as it was before another process wrote, until this process
 * writes: `hidden` is left out of its listing and `stale` reads as `before`.
 */
const lateReader = (
  root: string,
  view: { readonly hidden: string; readonly stale: string; readonly before: string },
): typeof NodeServices.layer =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let wrote = false;
      return {
        ...fs,
        readDirectory: (path, options) =>
          Effect.map(fs.readDirectory(path, options), (names) =>
            wrote || path !== join(root, ".octodo")
              ? names
              : names.filter((name) => name !== view.hidden),
          ),
        readFileString: (path, encoding) =>
          wrote || path !== join(root, ".octodo", view.stale)
            ? fs.readFileString(path, encoding)
            : Effect.succeed(view.before),
        writeFileString: (path, data, options) => {
          wrote = true;
          return fs.writeFileString(path, data, options);
        },
      };
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

const fresh = async () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  return root;
};

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
  writeFileSync(join(root, ".octodo", file), content);
};

const read = (root: string, file: string) => readFileSync(join(root, ".octodo", file), "utf8");

/** A workspace that stays open across calls, as the app keeps one with its cache. */
const openApp = async (root: string) => {
  let workspace!: Workspace;
  let close!: () => void;
  const closed = new Promise<void>((resolve) => (close = resolve));
  const opened = new Promise<void>((resolve) => {
    void run(
      Effect.gen(function* () {
        workspace = yield* makeWorkspace("app", root);
        resolve();
        yield* Effect.promise(() => closed);
      }),
    );
  });
  await opened;
  return { use: <A, E>(f: (ws: Workspace) => Effect.Effect<A, E>) => run(f(workspace)), close };
};

const ids = (root: string) =>
  run(Effect.flatMap(makeWorkspace("check", root), (ws) => ws.snapshot)).then((snapshot) => ({
    ids: snapshot.tasks.map((task) => task.id).toSorted(),
    diagnostics: snapshot.diagnostics.map((diagnostic) => diagnostic.message),
  }));

describe("task ids across processes", () => {
  it("never gives a new task an id that another process created since this one last read", async () => {
    const root = await fresh();
    const app = await openApp(root);
    await app.use((ws) => ws.snapshot);
    const cli = await run(
      Effect.flatMap(makeWorkspace("cli", root), (ws) => ws.createTask({ title: "From the CLI" })),
    );
    const fromApp = await app.use((ws) => ws.createTask({ title: "From the app" }));
    app.close();
    expect(cli.id).toBe("HM-1");
    expect(fromApp.id).toBe("HM-2");
    expect(await ids(root)).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
  });

  it("gives distinct ids to creates that run at the same time in separate workspaces", async () => {
    const root = await fresh();
    const creates = Array.from({ length: 12 }, (_, index) =>
      run(
        Effect.flatMap(makeWorkspace(`p${index}`, root), (ws) =>
          ws.createTask({ title: `Task ${index}` }),
        ),
      ),
    );
    const created = (await Promise.all(creates)).map((task) => task.id);
    expect(new Set(created).size).toBe(created.length);
    const onDisk = await ids(root);
    expect(onDisk.diagnostics).toEqual([]);
    expect(onDisk.ids).toEqual(created.toSorted());
  });

  it("gives a hand-made file one id when several workspaces read it at once, and two files two ids", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    write(root, "bread/task.md", "Buy bread\n");
    const reads = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        run(Effect.flatMap(makeWorkspace(`p${index}`, root), (ws) => ws.snapshot)),
      ),
    );
    const milk = /id: (HM-\d+)/.exec(read(root, "milk/task.md"))![1];
    const bread = /id: (HM-\d+)/.exec(read(root, "bread/task.md"))![1];
    expect(milk).not.toBe(bread);
    for (const snapshot of reads) {
      const byTitle = Object.fromEntries(snapshot.tasks.map((task) => [task.title, task.id]));
      expect(byTitle).toEqual({ Milk: milk, Bread: bread });
    }
    expect(read(root, "milk/task.md")).toBe(`---\nid: ${milk}\n---\n\nBuy milk\n`);
  });

  it("keeps the id another process gave a hand-made file after this one read it without an id", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    write(root, "bread/task.md", "Buy bread\n");
    await run(Effect.flatMap(makeWorkspace("first", root), (ws) => ws.snapshot));
    const first = { bread: read(root, "bread/task.md"), milk: read(root, "milk/task.md") };
    const late = lateReader(root, { hidden: "bread", stale: "milk/task.md", before: "Buy milk\n" });
    const snapshot = await run(
      Effect.flatMap(makeWorkspace("late", root), (ws) => ws.snapshot),
      late,
    );
    expect({ bread: read(root, "bread/task.md"), milk: read(root, "milk/task.md") }).toEqual(first);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("gives a file whose id is null or ~ an id in one read", { timeout: 3000 }, async () => {
    const root = await fresh();
    write(root, "milk/task.md", "---\nid: null\n---\n\nBuy milk\n");
    write(root, "bread/task.md", "---\nid: ~\n---\n\nBuy bread\n");
    const onDisk = await ids(root);
    expect(onDisk).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
    expect(read(root, "bread/task.md")).toMatch(/^---\nid: HM-\d\n---\n\nBuy bread\n$/);
  });

  it("reports a task it cannot give an id to and reads the rest", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    mkdirSync(join(root, ".octodo/milk/.pending-id"));
    write(root, "bread/task.md", "Buy bread\n");
    const onDisk = await ids(root);
    expect(onDisk.ids).toEqual(["HM-1"]);
    expect(onDisk.diagnostics).toEqual([
      expect.stringMatching(/^This task has no id and writing one failed/),
    ]);
  });

  it("leaves nothing behind in .octodo once creates finish", async () => {
    const root = await fresh();
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        run(
          Effect.flatMap(makeWorkspace(`p${index}`, root), (ws) =>
            ws.createTask({ title: `Task ${index}` }),
          ),
        ),
      ),
    );
    const hidden = readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" }).filter(
      (entry) => entry.split("/").some((part) => part.startsWith(".")),
    );
    expect(hidden).toEqual([]);
  });

  it("skips an id another process holds a claim on, and frees a claim a crash left once it is a minute old", async () => {
    const root = await fresh();
    write(root, ".claim-HM-1", "");
    write(root, ".claim-HM-3", "");
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    utimesSync(join(root, ".octodo/.claim-HM-1"), twoMinutesAgo, twoMinutesAgo);
    const created = await run(
      Effect.gen(function* () {
        const ws = yield* makeWorkspace("cli", root);
        return [
          (yield* ws.createTask({ title: "First" })).id,
          (yield* ws.createTask({ title: "Second" })).id,
        ];
      }),
    );
    expect(created).toEqual(["HM-1", "HM-2"]);
    expect(existsSync(join(root, ".octodo/.claim-HM-3")), "a live claim stays").toBe(true);
    const third = await run(
      Effect.flatMap(makeWorkspace("cli", root), (ws) => ws.createTask({ title: "Third" })),
    );
    expect(third.id).toBe("HM-4");
  });

  it("finishes giving the id a crashed process picked for a hand-made file, and never hands it out again", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    write(root, "milk/.pending-id", "HM-7\n");
    const created = await run(
      Effect.flatMap(makeWorkspace("cli", root), (ws) => ws.createTask({ title: "New" })),
    );
    expect(read(root, "milk/task.md")).toMatch(/^---\nid: HM-7\n/);
    expect(existsSync(join(root, ".octodo/milk/.pending-id"))).toBe(false);
    expect(created.id).toBe("HM-8");
    expect(await ids(root), "a marker the read finishes is no problem").toEqual({
      ids: ["HM-7", "HM-8"],
      diagnostics: [],
    });
  });

  it("gives a copied task a new id past one another process holds a claim on", async () => {
    const root = await fresh();
    write(root, "HM-1-paint/task.md", "---\nid: HM-1\n---\n");
    write(root, "HM-1-paint-copy/task.md", "---\nid: HM-1\n---\n");
    write(root, ".claim-HM-2", "");
    const result = await run(Effect.flatMap(makeWorkspace("app", root), (ws) => ws.fixAll));
    expect(result.failed).toEqual([]);
    expect(read(root, "HM-3-paint-copy/task.md")).toBe("---\nid: HM-3\n---\n");
  });

  it("never gives a fixed copy the id of a task another workspace creates at the same time", async () => {
    const root = await fresh();
    write(root, "HM-1-a/task.md", "---\nid: HM-1\n---\n");
    for (const copy of ["b", "c", "d", "e"])
      write(root, `HM-1-${copy}/task.md`, "---\nid: HM-1\n---\n");
    const [fixed, ...created] = await Promise.all([
      run(Effect.flatMap(makeWorkspace("app", root), (ws) => ws.fixAll)),
      ...Array.from({ length: 8 }, (_, index) =>
        run(
          Effect.flatMap(makeWorkspace(`cli${index}`, root), (ws) =>
            ws.createTask({ title: `Task ${index}` }),
          ),
        ),
      ),
    ]);
    expect(fixed.failed).toEqual([]);
    const onDisk = await ids(root);
    expect(onDisk.diagnostics).toEqual([]);
    expect(onDisk.ids).toHaveLength(1 + 4 + created.length);
  });
});
