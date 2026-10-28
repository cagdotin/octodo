import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Stream } from "effect";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/scan.ts";
import { makeStorage } from "../src/storage/storage.ts";
import { initWorkspace, makeWorkspace, type Workspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

const fresh = () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  return root;
};

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo/tasks", file)), { recursive: true });
  writeFileSync(join(root, ".octodo/tasks", file), content);
};

const fullScan = (root: string) =>
  Effect.flatMap(makeStorage(root), (storage) =>
    Effect.map(storage.read, (read) => scanWorkspace("test", root, read).snapshot),
  );

/** The workspace's snapshot once it equals a full scan, or the last one after `wait`. */
const settled = (ws: Workspace, root: string, wait: number) =>
  Effect.gen(function* () {
    const deadline = Date.now() + wait;
    for (;;) {
      const [kept, scanned] = [yield* ws.snapshot, yield* fullScan(root)];
      if (Date.now() >= deadline || JSON.stringify(kept) === JSON.stringify(scanned))
        return { kept, scanned };
      yield* Effect.sleep("20 millis");
    }
  });

type Step = readonly [
  name: string,
  change: (ws: Workspace, root: string) => Effect.Effect<unknown, unknown>,
  /** Whether it changes the files behind the workspace's back, as a person or a sync tool does. */
  external: boolean,
];

const byApp = (name: string, change: (ws: Workspace) => Effect.Effect<unknown, unknown>): Step => [
  name,
  (ws) => change(ws),
  false,
];

const byHand = (name: string, change: (root: string) => void): Step => [
  name,
  (_, root) => Effect.sync(() => change(root)),
  true,
];

const steps: ReadonlyArray<Step> = [
  byApp("create a task", (ws) => ws.createTask({ title: "Paint the hall", body: "See [[HM-9]]" })),
  byApp("create a list", (ws) => ws.createList({ name: "Garden" })),
  byApp("create a task in a list", (ws) => ws.createTask({ title: "Seeds", list: "garden" })),
  byApp("create a subtask", (ws) => ws.createTask({ title: "Buy paint", parent: "HM-10" })),
  byApp("link a blocker", (ws) => ws.updateTask("HM-11", { blocked_by: ["HM-10"] })),
  byApp("change a status", (ws) => ws.moveTask("HM-10", { status: "in-progress" })),
  byApp("rename a task with a subtask", (ws) => ws.updateTask("HM-10", { title: "Paint" })),
  byApp("close the blocker", (ws) => ws.moveTask("HM-10", { status: "done" })),
  byApp("move a task with a subtask to a list", (ws) => ws.moveTask("HM-10", { list: "garden" })),
  byApp("close a moved subtask", (ws) => ws.moveTask("HM-12", { status: "done" })),
  byApp("move a task with a subtask back", (ws) => ws.moveTask("HM-10", { list: null })),
  byApp("move it to the list again", (ws) => ws.moveTask("HM-10", { list: "garden" })),
  byApp("create a nested list", (ws) => ws.createList({ name: "Beds", parent: "garden" })),
  byApp("move a list", (ws) => ws.moveList("garden/beds", { parent: null })),
  byHand("edit a task by hand", (root) => {
    const file = join(root, ".octodo/tasks/garden/HM-11-seeds/task.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("status: todo", "status: someday"));
  }),
  byHand("add a task by hand, without an id", (root) =>
    write(root, "garden/weeds/task.md", "Pull the weeds\n"),
  ),
  byHand("copy a task folder by hand", (root) =>
    cpSync(
      join(root, ".octodo/tasks/garden/HM-11-seeds"),
      join(root, ".octodo/tasks/HM-11-seeds 2"),
      {
        recursive: true,
      },
    ),
  ),
  byHand("add a loose markdown file", (root) => write(root, "beds/notes.md", "Loose notes\n")),
  byHand("add a task folder named like a temporary file", (root) =>
    write(root, "backup.tmp/task.md", "---\nid: HM-50\ntitle: Backup\n---\n"),
  ),
  byHand("delete a task folder by hand", (root) =>
    rmSync(join(root, ".octodo/tasks/garden/HM-10-paint"), { recursive: true }),
  ),
  byApp("delete a task", (ws) => ws.deleteTask("HM-11")),
  byHand("delete a list by hand", (root) =>
    rmSync(join(root, ".octodo/tasks/beds"), { recursive: true }),
  ),
  byApp("create a task after it all", (ws) => ws.createTask({ title: "Last" })),
];

describe("the kept snapshot", () => {
  it.each([true, false])(
    "matches a full scan after each change, watching: %s",
    { timeout: 30_000 },
    async (watch) => {
      const root = fresh();
      await run(
        Effect.gen(function* () {
          yield* initWorkspace(root);
          write(root, "HM-9-old/task.md", "---\nid: HM-9\ntitle: Old\nblocked_by: [HM-10]\n---\n");
          const ws = yield* makeWorkspace("test", root, { watch });
          for (const [name, change, external] of steps) {
            if (external && !watch) continue;
            const before = yield* ws.snapshot;
            yield* change(ws, root);
            const { kept, scanned } = yield* settled(ws, root, external ? 5000 : 0);
            expect(kept, `after "${name}"`).toEqual(scanned);
            expect(kept, `"${name}" changes the snapshot`).not.toEqual(before);
          }
        }),
      );
    },
  );

  it("sees changes by hand once its watcher has stopped", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    write(root, "HM-1-a/task.md", "---\nid: HM-1\ntitle: Before\n---\n");
    const deadWatcher = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fs) => ({
        ...fs,
        watch: () => Stream.fail(new Error("watcher died") as never),
      })),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    const titles = await Effect.runPromise(
      Effect.gen(function* () {
        const ws = yield* makeWorkspace("test", root, { watch: true });
        yield* Effect.sleep("50 millis");
        const before = yield* ws.snapshot;
        write(root, "HM-1-a/task.md", "---\nid: HM-1\ntitle: After\n---\n");
        const after = yield* ws.snapshot;
        return [before, after].map((snapshot) => snapshot.tasks[0]!.title);
      }).pipe(Effect.scoped, Effect.provide(deadWatcher)),
    );
    expect(titles).toEqual(["Before", "After"]);
  });

  it("reads everything again after a write when nothing reports changes by hand", async () => {
    const root = fresh();
    const { kept, scanned } = await run(
      Effect.gen(function* () {
        yield* initWorkspace(root);
        const ws = yield* makeWorkspace("test", root);
        const first = yield* ws.createTask({ title: "Alpha" });
        yield* ws.createTask({ title: "Beta" });
        const file = join(root, first.path);
        writeFileSync(file, readFileSync(file, "utf8").replace("Alpha", "Edited"));
        yield* ws.updateTask("HM-2", { title: "Gamma" });
        yield* ws.updateTask("HM-2", { title: "Delta" });
        return { kept: yield* ws.snapshot, scanned: yield* fullScan(root) };
      }),
    );
    expect(kept.tasks.map((task) => task.title)).toEqual(["Edited", "Delta"]);
    expect(kept).toEqual(scanned);
  });

  it(
    "does not keep a snapshot read while a file changed under it",
    { timeout: 10_000 },
    async () => {
      const root = fresh();
      await run(initWorkspace(root));
      write(root, "HM-1-a/task.md", "---\nid: HM-1\ntitle: Before\n---\n");
      const file = join(root, ".octodo/tasks/HM-1-a/task.md");
      let armed = false;
      const editedMidRead = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          return {
            ...fs,
            readFileString: (target, encoding) =>
              target !== file || !armed
                ? fs.readFileString(target, encoding)
                : Effect.gen(function* () {
                    armed = false;
                    const text = yield* fs.readFileString(target, encoding);
                    writeFileSync(file, text.replace("Before", "After"));
                    yield* Effect.sleep("500 millis");
                    return text;
                  }),
          } satisfies FileSystem.FileSystem;
        }),
      ).pipe(Layer.provideMerge(NodeServices.layer));
      const titles = await Effect.runPromise(
        Effect.gen(function* () {
          const ws = yield* makeWorkspace("test", root, { watch: true });
          // FSEvents reports nothing until its stream has started.
          yield* Effect.sleep("300 millis");
          armed = true;
          const during = yield* ws.snapshot;
          yield* Effect.sleep("300 millis");
          const after = yield* ws.snapshot;
          return [during, after].map((snapshot) => snapshot.tasks[0]!.title);
        }).pipe(Effect.scoped, Effect.provide(editedMidRead)),
      );
      expect(titles).toEqual(["Before", "After"]);
    },
  );
});
