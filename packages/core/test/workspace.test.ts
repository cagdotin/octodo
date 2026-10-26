import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace, makeWorkspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

const fresh = () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  return root;
};

const open = (root: string) =>
  Effect.gen(function* () {
    yield* initWorkspace(root);
    return yield* makeWorkspace("test", root);
  });

describe("workspace", () => {
  it("initialises config and default status folders", async () => {
    const root = fresh();
    const snapshot = await run(Effect.flatMap(open(root), (ws) => ws.snapshot));
    expect(snapshot.workspace).toMatchObject({ name: "House Move", key: "CT" });
    expect(snapshot.statuses.map((status) => status.id)).toEqual([
      "backlog",
      "todo",
      "in-progress",
      "done",
      "archived",
    ]);
    expect(readdirSync(join(root, ".octodo")).toSorted()).toEqual([
      "config.json",
      "s00-backlog",
      "s01-todo",
      "s02-in-progress",
      "s03-done",
      "s04-archived",
    ]);
  });

  it("creates tasks with sequential ids in the default status", async () => {
    const root = fresh();
    const [a, b] = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        return [
          yield* ws.createTask({ title: "First" }),
          yield* ws.createTask({ title: "Second", priority: "high" }),
        ];
      }),
    );
    expect(a).toMatchObject({
      id: "CT-1",
      status: "todo",
      list: null,
      path: ".octodo/s01-todo/CT-1-first.md",
    });
    expect(b).toMatchObject({ id: "CT-2", priority: "high" });
    expect(a!.order < b!.order).toBe(true);
  });

  it("moves a task by moving its file, and orders it between neighbours", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const one = yield* ws.createTask({ title: "One", status: "done" });
        const two = yield* ws.createTask({ title: "Two", status: "done" });
        const three = yield* ws.createTask({ title: "Three" });
        yield* ws.moveTask(three.id, { status: "done", before: two.id });
        return { one, snapshot: yield* ws.snapshot };
      }),
    );
    const done = result.snapshot.tasks
      .filter((task) => task.status === "done")
      .map((task) => task.id);
    expect(done).toEqual(["CT-1", "CT-3", "CT-2"]);
    expect(readdirSync(join(root, ".octodo/s03-done")).toSorted()).toEqual([
      "CT-1-one.md",
      "CT-2-two.md",
      "CT-3-three.md",
    ]);
  });

  it("reads lists, assigns ids to hand-written files and reports stray files", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    mkdirSync(join(root, ".octodo/l-groceries/s-todo"), { recursive: true });
    writeFileSync(join(root, ".octodo/l-groceries/s-todo/milk.md"), "Buy oat milk\n");
    writeFileSync(join(root, ".octodo/stray.md"), "lost\n");
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.lists).toEqual([
      { id: "groceries", name: "Groceries", parent: null, folder: "l-groceries" },
    ]);
    expect(snapshot.tasks).toMatchObject([
      { id: "CT-1", title: "Milk", list: "groceries", body: "Buy oat milk\n" },
    ]);
    expect(readFileSync(join(root, ".octodo/l-groceries/s-todo/milk.md"), "utf8")).toBe(
      "---\nid: CT-1\n---\n\nBuy oat milk\n",
    );
    expect(snapshot.diagnostics).toEqual([
      { path: ".octodo/stray.md", message: "Task file is not inside a status folder" },
    ]);
  });

  it("keeps unmanaged frontmatter when updating", async () => {
    const root = fresh();
    const task = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const created = yield* ws.createTask({ title: "Edit me" });
        const file = join(root, created.path);
        writeFileSync(file, readFileSync(file, "utf8").replace("---\n", "---\nestimate: 3\n"));
        return yield* ws.updateTask(created.id, { title: "Edited", body: "Notes" });
      }),
    );
    expect(task).toMatchObject({ title: "Edited", body: "Notes\n", extra: { estimate: 3 } });
  });

  it("rejects unknown statuses", async () => {
    const root = fresh();
    const error = await run(
      Effect.flip(
        Effect.flatMap(open(root), (ws) => ws.createTask({ title: "x", status: "nope" })),
      ),
    );
    expect(error).toMatchObject({ _tag: "InvalidRequest", message: 'Unknown status "nope"' });
  });

  it("orders lists by folder number, then unnumbered ones by name, depth first", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    for (const dir of ["l01-home", "l00-work/l00-q3", "l-zoo", "l-attic", "l01-work-copy"]) {
      mkdirSync(join(root, ".octodo", dir), { recursive: true });
    }
    mkdirSync(join(root, ".octodo/l05-work"), { recursive: true });
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.lists.map((list) => list.id)).toEqual([
      "work",
      "work/q3",
      "home",
      "work-copy",
      "attic",
      "zoo",
    ]);
    expect(snapshot.diagnostics).toEqual([
      {
        path: ".octodo/l05-work",
        message: 'Another folder is already list "work"; this one is not read',
      },
    ]);
  });

  it("creates lists last among their siblings and refuses a fourth level", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        const garden = yield* ws.createList({ name: "Garden" });
        const seeds = yield* ws.createList({ name: "Seeds", parent: garden.id });
        const tomatoes = yield* ws.createList({ name: "Tomatoes", parent: seeds.id });
        const error = yield* Effect.flip(ws.createList({ name: "Deep", parent: tomatoes.id }));
        return { garden, tomatoes, error };
      }),
    );
    expect(result.garden).toEqual({
      id: "garden",
      name: "Garden",
      parent: null,
      folder: "l01-garden",
    });
    expect(result.tomatoes.folder).toBe("l01-garden/l00-seeds/l00-tomatoes");
    expect(result.error).toMatchObject({ message: "Lists nest at most 3 levels deep" });
  });

  it("reorders lists by renumbering their folders, and moves them under another list", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        for (const name of ["A", "B", "C"]) yield* ws.createList({ name });
        const task = yield* ws.createTask({ title: "Inside C", list: "c" });
        yield* ws.moveList("c", { before: "a" });
        const reordered = (yield* ws.snapshot).lists.map((list) => list.folder);
        const moved = yield* ws.moveList("c", { parent: "b" });
        const snapshot = yield* ws.snapshot;
        return { reordered, moved, task: yield* ws.getTask(task.id), snapshot };
      }),
    );
    expect(result.reordered).toEqual(["l00-c", "l01-a", "l02-b"]);
    expect(result.moved).toEqual({ id: "b/c", name: "C", parent: "b", folder: "l01-b/l00-c" });
    expect(result.snapshot.lists.map((list) => list.folder)).toEqual([
      "l00-a",
      "l01-b",
      "l01-b/l00-c",
    ]);
    expect(result.task).toMatchObject({
      list: "b/c",
      path: ".octodo/l01-b/l00-c/s01-todo/CT-1-inside-c.md",
    });
  });

  it("refuses to move a list into itself or deeper than three levels", async () => {
    const root = fresh();
    const errors = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "A" });
        yield* ws.createList({ name: "B", parent: "a" });
        yield* ws.createList({ name: "C", parent: "a/b" });
        yield* ws.createList({ name: "X" });
        return [
          yield* Effect.flip(ws.moveList("a", { parent: "a/b" })),
          yield* Effect.flip(ws.moveList("x", { parent: "a/b/c" })),
          yield* Effect.flip(ws.moveList("a", { parent: "x" })),
        ];
      }),
    );
    expect(errors.map((error) => error.message)).toEqual([
      "A list cannot move inside itself",
      "Lists nest at most 3 levels deep",
      "Lists nest at most 3 levels deep",
    ]);
  });

  it("reorders statuses within their category and renumbers every status folder", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        yield* ws.createTask({ title: "Review", status: "done", list: "home" });
        const config = JSON.parse(readFileSync(join(root, ".octodo/config.json"), "utf8"));
        config.statuses.splice(3, 0, { id: "in-review", name: "In Review", category: "started" });
        config.extra = true;
        writeFileSync(join(root, ".octodo/config.json"), JSON.stringify(config));
        mkdirSync(join(root, ".octodo/s-in-review"));
        // Re-open so the hand edit is read.
        const fresh = yield* makeWorkspace("test", root);
        return yield* fresh.reorderStatuses({
          order: ["done", "in-review", "todo", "in-progress", "backlog", "archived"],
        });
      }),
    );
    expect(result.map((status) => status.id)).toEqual([
      "backlog",
      "todo",
      "in-review",
      "in-progress",
      "done",
      "archived",
    ]);
    expect(readdirSync(join(root, ".octodo")).toSorted()).toEqual([
      "config.json",
      "l00-home",
      "s00-backlog",
      "s01-todo",
      "s02-in-review",
      "s03-in-progress",
      "s04-done",
      "s05-archived",
    ]);
    expect(readdirSync(join(root, ".octodo/l00-home"))).toEqual(["s04-done"]);
    const config = JSON.parse(readFileSync(join(root, ".octodo/config.json"), "utf8"));
    expect(config.extra).toBe(true);
    expect(config.statuses[2]).toEqual({ id: "in-review", name: "In Review", category: "started" });
  });
});
