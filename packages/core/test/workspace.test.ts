import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

/** Every file under `.octodo/` but the config, relative to it and sorted. */
const files = (root: string) =>
  readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" })
    .filter((entry) => statSync(join(root, ".octodo", entry)).isFile() && entry !== "config.json")
    .toSorted();

const read = (root: string, file: string) => readFileSync(join(root, ".octodo", file), "utf8");

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
  writeFileSync(join(root, ".octodo", file), content);
};

const ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

describe("workspace", () => {
  it("initialises .octodo with a config and nothing else", async () => {
    const root = fresh();
    const snapshot = await run(Effect.flatMap(open(root), (ws) => ws.snapshot));
    expect(snapshot.workspace).toMatchObject({ name: "House Move", key: "HM" });
    expect(snapshot.statuses.map((status) => status.id)).toEqual([
      "backlog",
      "todo",
      "in-progress",
      "done",
      "archived",
    ]);
    expect(readdirSync(join(root, ".octodo"))).toEqual(["config.json"]);
  });

  it("creates each task as a folder with task.md, in the default status, defaults left out", async () => {
    const root = fresh();
    const [a, b] = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        return [
          yield* ws.createTask({ title: "First", tags: [], due: null }),
          yield* ws.createTask({ title: "Second", priority: "high", body: "Notes" }),
        ];
      }),
    );
    expect(a).toMatchObject({
      id: "HM-1",
      status: "todo",
      list: null,
      parent: null,
      path: ".octodo/HM-1-first/task.md",
    });
    expect(a!.updated).toMatch(ISO);
    expect(b).toMatchObject({ id: "HM-2", priority: "high", body: "Notes\n" });
    expect(a!.order < b!.order).toBe(true);
    expect(files(root)).toEqual(["HM-1-first/task.md", "HM-2-second/task.md"]);
    expect(read(root, "HM-1-first/task.md")).toBe(
      `---\nid: HM-1\ntitle: First\nstatus: todo\ncreated: ${a!.created}\norder: ${a!.order}\n---\n`,
    );
    expect(read(root, "HM-2-second/task.md")).toContain("priority: high\n");
    expect(readdirSync(join(root, ".octodo")).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("creates subtasks inside their parent's folder, in the parent's list", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        const parent = yield* ws.createTask({ title: "Redo the bedroom", list: "home" });
        const child = yield* ws.createTask({ title: "Buy primer", parent: parent.id });
        const grandchild = yield* ws.createTask({ title: "Pick a shop", parent: child.id });
        const error = yield* Effect.flip(
          ws.createTask({ title: "Both", list: "home", parent: parent.id }),
        );
        return { child, grandchild, error };
      }),
    );
    expect(result.child).toMatchObject({ list: "home", parent: "HM-1" });
    expect(result.grandchild).toMatchObject({
      list: "home",
      parent: "HM-2",
      path: ".octodo/home/HM-1-redo-the-bedroom/HM-2-buy-primer/HM-3-pick-a-shop/task.md",
    });
    expect(result.error).toMatchObject({ _tag: "InvalidRequest" });
  });

  it("reads a hand-written tree by its markers, ignoring attachments and folder names", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    write(root, "home/list.md", "---\nname: Our home\norder: a1\n---\nRooms and repairs.\n");
    write(root, "garden/list.md", "---\norder: a0\n---\n");
    write(root, "garden/seeds/list.md", "");
    write(
      root,
      "home/redo-bedroom/task.md",
      "---\nid: HM-12\ntitle: Redo the bedroom\nstatus: in-progress\n---\n",
    );
    write(root, "home/redo-bedroom/images/floor-plan.png", "png");
    write(root, "home/redo-bedroom/notes.md", "not a task");
    write(root, "home/redo-bedroom/primer/task.md", "---\nid: HM-13\ntitle: Buy primer\n---\n");
    write(root, "home/redo-bedroom/primer/tins/task.md", "---\nid: HM-14\nstatus: done\n---\n");
    write(root, "milk/task.md", "Buy oat milk\n");
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.lists).toEqual([
      { id: "garden", name: "Garden", parent: null, folder: "garden" },
      { id: "garden/seeds", name: "Seeds", parent: "garden", folder: "garden/seeds" },
      { id: "home", name: "Our home", parent: null, folder: "home" },
    ]);
    const byId = Object.fromEntries(snapshot.tasks.map((task) => [task.id, task]));
    expect(byId["HM-12"]).toMatchObject({ status: "in-progress", list: "home", parent: null });
    expect(byId["HM-13"]).toMatchObject({ status: "todo", list: "home", parent: "HM-12" });
    expect(byId["HM-14"]).toMatchObject({
      title: "Tins",
      status: "done",
      list: "home",
      parent: "HM-13",
      path: ".octodo/home/redo-bedroom/primer/tins/task.md",
    });
    expect(byId["HM-15"]).toMatchObject({ title: "Milk", body: "Buy oat milk\n", list: null });
    expect(read(root, "milk/task.md")).toBe("---\nid: HM-15\n---\n\nBuy oat milk\n");
    expect(read(root, "home/redo-bedroom/primer/task.md")).not.toContain("status");
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("reports what breaks the grammar and still reads the rest", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    write(root, "stray.md", "lost");
    write(root, "home/list.md", "");
    write(root, "home/notes.md", "loose");
    write(root, "home/HM-1-paint/task.md", "---\nid: HM-1\ntitle: Paint\n---\n");
    write(root, "home/HM-1-paint/shopping/list.md", "");
    write(root, "home/HM-1-paint-copy/task.md", "---\nid: HM-1\ntitle: Paint\n---\n");
    write(root, "home/HM-1-paint-copy/HM-9-sub/task.md", "---\nid: HM-9\n---\n");
    write(root, "both/task.md", "---\nid: HM-2\n---\n");
    write(root, "both/list.md", "");
    write(root, "random/readme.txt", "");
    write(root, "broken/task.md", "---\nid: [unclosed\n---\n");
    write(root, "HM-3-review/task.md", "---\nid: HM-3\nstatus: in-review\n---\n");
    write(root, "a/list.md", "");
    write(root, "a/b/list.md", "");
    write(root, "a/b/c/list.md", "");
    write(root, "a/b/c/d/list.md", "");
    write(root, ".hidden/task.md", "---\nid: HM-4\n---\n");
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.tasks.map((task) => task.id).toSorted()).toEqual(["HM-1", "HM-3"]);
    expect(snapshot.lists.map((list) => list.id)).toEqual(["a", "a/b", "a/b/c", "home"]);
    expect(snapshot.statuses.find((status) => status.id === "in-review")).toEqual({
      id: "in-review",
      name: "In Review",
      category: "unstarted",
    });
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.path).toSorted()).toEqual([
      ".octodo/HM-3-review/task.md",
      ".octodo/a/b/c/d",
      ".octodo/both",
      ".octodo/broken/task.md",
      ".octodo/home/HM-1-paint-copy/task.md",
      ".octodo/home/HM-1-paint/shopping",
      ".octodo/home/notes.md",
      ".octodo/random",
      ".octodo/stray.md",
    ]);
  });

  it("points an old-layout workspace at octo migrate once", async () => {
    const root = fresh();
    await run(initWorkspace(root));
    write(root, "s01-todo/HM-1-a.md", "---\nid: HM-1\n---\n");
    write(root, "l00-home/s01-todo/HM-2-b.md", "---\nid: HM-2\n---\n");
    write(root, "l01-garden/s03-done/HM-3-c.md", "---\nid: HM-3\n---\n");
    const snapshot = await run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.snapshot));
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({ path: ".octodo" });
    expect(snapshot.diagnostics[0]!.message).toContain("octo migrate");
  });

  it("updates task.md in place, keeps unknown keys and renames the folder after the title", async () => {
    const root = fresh();
    const task = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const created = yield* ws.createTask({ title: "Edit me", priority: "high" });
        const file = join(root, created.path);
        writeFileSync(file, readFileSync(file, "utf8").replace("---\n", "---\nestimate: 3\n"));
        return yield* ws.updateTask(created.id, {
          title: "Edited",
          body: "Notes",
          priority: "none",
        });
      }),
    );
    expect(task).toMatchObject({
      title: "Edited",
      body: "Notes\n",
      priority: "none",
      extra: { estimate: 3 },
      path: ".octodo/HM-1-edited/task.md",
    });
    expect(files(root)).toEqual(["HM-1-edited/task.md"]);
    const text = read(root, "HM-1-edited/task.md");
    expect(text).toMatch(/^---\nestimate: 3\nid: HM-1\ntitle: Edited\nstatus: todo\n/);
    expect(text).not.toMatch(/priority|updated/);
  });

  it("keeps a stale folder name when the new one is taken", async () => {
    const root = fresh();
    const task = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const created = yield* ws.createTask({ title: "Old" });
        mkdirSync(join(root, ".octodo/HM-1-new"));
        return yield* ws.updateTask(created.id, { title: "New" });
      }),
    );
    expect(task).toMatchObject({ title: "New", path: ".octodo/HM-1-old/task.md" });
  });

  it("changes status and order by writing task.md, without moving the folder", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createTask({ title: "One", status: "done" });
        const two = yield* ws.createTask({ title: "Two", status: "done" });
        const three = yield* ws.createTask({ title: "Three" });
        yield* ws.moveTask(three.id, { status: "done", before: two.id });
        return yield* ws.snapshot;
      }),
    );
    const done = snapshot.tasks.filter((task) => task.status === "done").map((task) => task.id);
    expect(done).toEqual(["HM-1", "HM-3", "HM-2"]);
    expect(files(root)).toEqual(["HM-1-one/task.md", "HM-2-two/task.md", "HM-3-three/task.md"]);
    expect(read(root, "HM-3-three/task.md")).toContain("status: done\n");
  });

  it("moves a task with its subtasks into a list, under another task, and back out", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        const paint = yield* ws.createTask({ title: "Paint" });
        yield* ws.createTask({ title: "Primer", parent: paint.id });
        const bedroom = yield* ws.createTask({ title: "Bedroom", list: "home" });
        const intoList = yield* ws.moveTask(paint.id, { list: "home" });
        const underTask = yield* ws.moveTask(paint.id, { parent: bedroom.id });
        const subtask = yield* ws.getTask("HM-2");
        const lifted = yield* ws.moveTask(paint.id, { parent: null });
        const both = yield* Effect.flip(ws.moveTask(paint.id, { list: null, parent: bedroom.id }));
        return { intoList, underTask, subtask, lifted, both };
      }),
    );
    expect(result.intoList).toMatchObject({ list: "home", parent: null });
    expect(result.underTask).toMatchObject({
      list: "home",
      parent: "HM-3",
      path: ".octodo/home/HM-3-bedroom/HM-1-paint/task.md",
    });
    expect(result.subtask).toMatchObject({ list: "home", parent: "HM-1" });
    expect(result.lifted).toMatchObject({
      list: "home",
      parent: null,
      path: ".octodo/home/HM-1-paint/task.md",
    });
    expect(result.both).toMatchObject({ _tag: "InvalidRequest" });
    expect(files(root)).toEqual([
      "home/HM-1-paint/HM-2-primer/task.md",
      "home/HM-1-paint/task.md",
      "home/HM-3-bedroom/task.md",
      "home/list.md",
    ]);
  });

  it("refuses to move a task into itself or its own subtree", async () => {
    const root = fresh();
    const errors = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const a = yield* ws.createTask({ title: "A" });
        const b = yield* ws.createTask({ title: "B", parent: a.id });
        const c = yield* ws.createTask({ title: "C", parent: b.id });
        return [
          yield* Effect.flip(ws.moveTask(a.id, { parent: a.id })),
          yield* Effect.flip(ws.moveTask(a.id, { parent: c.id })),
        ];
      }),
    );
    expect(errors.map((error) => error._tag)).toEqual(["InvalidRequest", "InvalidRequest"]);
    expect(files(root)).toEqual([
      "HM-1-a/HM-2-b/HM-3-c/task.md",
      "HM-1-a/HM-2-b/task.md",
      "HM-1-a/task.md",
    ]);
  });

  it("deletes a task with its subtasks and attachments", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const a = yield* ws.createTask({ title: "A" });
        yield* ws.createTask({ title: "B", parent: a.id });
        yield* ws.createTask({ title: "Keep" });
        write(root, "HM-1-a/images/x.png", "png");
        yield* ws.deleteTask(a.id);
        return yield* ws.snapshot;
      }),
    );
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["HM-3"]);
    expect(files(root)).toEqual(["HM-3-keep/task.md"]);
  });

  it("never recreates a container another process removed", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        const task = yield* ws.createTask({ title: "Stay" });
        yield* ws.snapshot;
        rmSync(join(root, ".octodo/home"), { recursive: true });
        return [
          yield* Effect.flip(ws.moveTask(task.id, { list: "home" })),
          yield* Effect.flip(ws.createTask({ title: "Lost", list: "home" })),
        ];
      }),
    );
    expect(result.map((error) => error._tag)).toEqual(["StorageError", "InvalidRequest"]);
    expect(existsSync(join(root, ".octodo/home"))).toBe(false);
    expect(files(root)).toEqual(["HM-1-stay/task.md"]);
  });

  it("creates lists as folders with list.md, last among their siblings, at most three deep", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        const garden = yield* ws.createList({ name: "Garden" });
        const seeds = yield* ws.createList({ name: "Seeds", parent: garden.id });
        const tomatoes = yield* ws.createList({ name: "Tomatoes", parent: seeds.id });
        const deep = yield* Effect.flip(ws.createList({ name: "Deep", parent: tomatoes.id }));
        const twice = yield* Effect.flip(ws.createList({ name: "home" }));
        return { garden, tomatoes, deep, twice, snapshot: yield* ws.snapshot };
      }),
    );
    expect(result.garden).toEqual({ id: "garden", name: "Garden", parent: null, folder: "garden" });
    expect(result.tomatoes.folder).toBe("garden/seeds/tomatoes");
    expect(result.snapshot.lists.map((list) => list.id)).toEqual([
      "home",
      "garden",
      "garden/seeds",
      "garden/seeds/tomatoes",
    ]);
    expect(result.deep).toMatchObject({ message: "Lists nest at most 3 levels deep" });
    expect(result.twice).toMatchObject({ _tag: "InvalidRequest" });
    expect(read(root, "garden/list.md")).toMatch(/^---\nname: Garden\norder: \S+\n---\n$/);
  });

  it("reorders lists by writing list.md and moves them with their tasks by one rename", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        for (const name of ["A", "B", "C"]) yield* ws.createList({ name });
        const task = yield* ws.createTask({ title: "Inside C", list: "c" });
        yield* ws.moveList("c", { before: "a" });
        const reordered = (yield* ws.snapshot).lists.map((list) => list.id);
        const folders = readdirSync(join(root, ".octodo")).toSorted();
        const moved = yield* ws.moveList("c", { parent: "b" });
        return { reordered, folders, moved, task: yield* ws.getTask(task.id) };
      }),
    );
    expect(result.reordered).toEqual(["c", "a", "b"]);
    expect(result.folders).toEqual(["a", "b", "c", "config.json"]);
    expect(result.moved).toEqual({ id: "b/c", name: "C", parent: "b", folder: "b/c" });
    expect(result.task).toMatchObject({
      list: "b/c",
      path: ".octodo/b/c/HM-1-inside-c/task.md",
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

  it("rejects unknown statuses, lists and parents", async () => {
    const root = fresh();
    const errors = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        return [
          yield* Effect.flip(ws.createTask({ title: "x", status: "nope" })),
          yield* Effect.flip(ws.createTask({ title: "x", list: "nope" })),
          yield* Effect.flip(ws.createTask({ title: "x", parent: "HM-99" })),
        ];
      }),
    );
    expect(errors.map((error) => error._tag)).toEqual([
      "InvalidRequest",
      "InvalidRequest",
      "InvalidRequest",
    ]);
  });

  it("reorders statuses in config.json only", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.createList({ name: "Home" });
        yield* ws.createTask({ title: "Review", status: "done", list: "home" });
        const config = JSON.parse(read(root, "config.json"));
        config.statuses.splice(3, 0, { id: "in-review", name: "In Review", category: "started" });
        config.extra = true;
        writeFileSync(join(root, ".octodo/config.json"), JSON.stringify(config));
        const before = files(root);
        const reopened = yield* makeWorkspace("test", root);
        const statuses = yield* reopened.reorderStatuses({
          order: ["done", "in-review", "todo", "in-progress", "backlog", "archived"],
        });
        return { before, statuses };
      }),
    );
    expect(result.statuses.map((status) => status.id)).toEqual([
      "backlog",
      "todo",
      "in-review",
      "in-progress",
      "done",
      "archived",
    ]);
    expect(files(root)).toEqual(result.before);
    const config = JSON.parse(read(root, "config.json"));
    expect(config.extra).toBe(true);
    expect(config.statuses[2]).toEqual({ id: "in-review", name: "In Review", category: "started" });
  });
});

describe("attachments", () => {
  const bytes = new TextEncoder().encode("png");

  it("saves files in the task folder, creating folders on the way, without new names clashing", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const task = yield* ws.createTask({ title: "Plan" });
        const first = yield* ws.writeAttachment(task.id, "images/floor plan.png", bytes);
        const second = yield* ws.writeAttachment(task.id, "images/floor plan.png", bytes);
        const top = yield* ws.writeAttachment(task.id, "quote", bytes);
        const absolute = yield* ws.attachmentPath(task.id, "images/floor plan.png");
        return { first, second, top, absolute, snapshot: yield* ws.snapshot };
      }),
    );
    expect([result.first, result.second, result.top]).toEqual([
      "images/floor plan.png",
      "images/floor plan-2.png",
      "quote",
    ]);
    expect(result.absolute).toBe(join(root, ".octodo/HM-1-plan/images/floor plan.png"));
    expect(readFileSync(result.absolute, "utf8")).toBe("png");
    expect(files(root)).toEqual([
      "HM-1-plan/images/floor plan-2.png",
      "HM-1-plan/images/floor plan.png",
      "HM-1-plan/quote",
      "HM-1-plan/task.md",
    ]);
    expect(result.snapshot.tasks).toHaveLength(1);
    expect(result.snapshot.diagnostics).toEqual([]);
  });

  it("refuses paths outside the folder, task.md, hidden names and subtasks", async () => {
    const root = fresh();
    const errors = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const task = yield* ws.createTask({ title: "Plan" });
        yield* ws.createTask({ title: "Sub", parent: task.id });
        const paths = [
          "/etc/passwd",
          "../escape.png",
          "images/../../escape.png",
          "task.md",
          "./task.md",
          ".hidden",
          "HM-2-sub/x.png",
          "",
        ];
        return [
          ...(yield* Effect.forEach(paths, (path) =>
            Effect.flip(ws.writeAttachment(task.id, path, bytes)),
          )),
          ...(yield* Effect.forEach(paths, (path) =>
            Effect.flip(ws.attachmentPath(task.id, path)),
          )),
          yield* Effect.flip(ws.writeAttachment("HM-99", "x.png", bytes)),
        ];
      }),
    );
    expect(errors.map((error) => error._tag)).toEqual([
      ...Array(16).fill("InvalidRequest"),
      "TaskNotFound",
    ]);
    expect(files(root)).toEqual(["HM-1-plan/HM-2-sub/task.md", "HM-1-plan/task.md"]);
    expect(existsSync(join(root, "escape.png"))).toBe(false);
    expect(existsSync(join(root, ".octodo/escape.png"))).toBe(false);
  });

  it("does not recreate a task folder another process removed", async () => {
    const root = fresh();
    const error = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const task = yield* ws.createTask({ title: "Gone" });
        yield* ws.snapshot;
        rmSync(join(root, ".octodo/HM-1-gone"), { recursive: true });
        return yield* Effect.flip(ws.writeAttachment(task.id, "images/x.png", bytes));
      }),
    );
    expect(error._tag).toBe("StorageError");
    expect(readdirSync(join(root, ".octodo"))).toEqual(["config.json"]);
  });
});
