import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  it.fails("never gives a new task an id that another process created since this one last read", async () => {
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

  it.fails("gives distinct ids to creates that run at the same time in separate workspaces", async () => {
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

  it.fails("keeps the id another process gave a hand-made file after this one read it without an id", async () => {
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
});
