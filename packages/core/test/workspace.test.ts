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
  const root = join(mkdtempSync(join(tmpdir(), "tasksmd-")), "house-move");
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
    expect(readdirSync(join(root, ".tasks")).toSorted()).toEqual([
      "config.json",
      "s-archived",
      "s-backlog",
      "s-done",
      "s-in-progress",
      "s-todo",
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
      path: ".tasks/s-todo/CT-1-first.md",
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
    expect(readdirSync(join(root, ".tasks/s-done")).toSorted()).toEqual([
      "CT-1-one.md",
      "CT-2-two.md",
      "CT-3-three.md",
    ]);
  });

  it("reads lists, assigns ids to hand-written files and reports stray files", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    mkdirSync(join(root, ".tasks/c-groceries/s-todo"), { recursive: true });
    writeFileSync(join(root, ".tasks/c-groceries/s-todo/milk.md"), "Buy oat milk\n");
    writeFileSync(join(root, ".tasks/stray.md"), "lost\n");
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.lists).toEqual([
      { id: "c-groceries", name: "Groceries", kind: "c", parent: null },
    ]);
    expect(snapshot.tasks).toMatchObject([
      { id: "CT-1", title: "Milk", list: "c-groceries", body: "Buy oat milk\n" },
    ]);
    expect(readFileSync(join(root, ".tasks/c-groceries/s-todo/milk.md"), "utf8")).toBe(
      "---\nid: CT-1\n---\n\nBuy oat milk\n",
    );
    expect(snapshot.diagnostics).toEqual([
      { path: ".tasks/stray.md", message: "Task file is not inside a status folder" },
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
});
