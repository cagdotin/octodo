import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMentions } from "../src/layout.ts";
import { editTaskFile, keepLinks, readTaskFile } from "../src/tasks/task-file.ts";
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

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
  writeFileSync(join(root, ".octodo", file), content);
};

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

const taskFile = (id: string, extra = "", body = "") =>
  `---\nid: ${id}\ntitle: Task ${id}\n${extra}---\n${body}`;

const place = {
  list: null,
  parent: null,
  path: ".octodo/HM-1/task.md",
  folder: "HM-1",
  defaultStatus: "todo",
  updated: null,
  key: "HM",
};

describe("mentions in a body", () => {
  it("finds [[KEY-N]] in order, outside code spans and fenced code", () => {
    const body = [
      "See [[HM-3]] and [[HM-7]], then [[HM-3]] again.",
      "Not `[[HM-8]]`, not ``a ` [[HM-9]]``, but [[hm-10]].",
      "",
      "```md",
      "[[HM-11]]",
      "```",
      "~~~",
      "[[HM-12]]",
      "~~~",
      "- [[HM-13]] [[not an id]] [[HM-]] [HM-14]",
      "",
      "```",
      "[[HM-15]] in a fence that never closes",
    ].join("\n");
    expect(findMentions(body).map((mention) => mention.id)).toEqual([
      "HM-3",
      "HM-7",
      "HM-3",
      "hm-10",
      "HM-13",
    ]);
    const [first] = findMentions(body);
    expect(body.slice(first!.from, first!.to)).toBe("[[HM-3]]");
  });

  it("reads a 300 KB body full of mentions and code spans in linear time", () => {
    const body =
      "x `a` [[HM-1]] ".repeat(20_000) + "\n\n" + "- see [[HM-2]] and `code`\n".repeat(3_000);
    const unmatched = "[[HM-3]] " + " a ``x".repeat(20_000);
    const started = performance.now();
    expect(findMentions(body)).toHaveLength(23_000);
    expect(findMentions(unmatched)).toHaveLength(1);
    expect(performance.now() - started, "a quadratic scan takes seconds here").toBeLessThan(500);
  });

  it("skips escaped mentions, indented code and HTML comments, as markdown renders them", () => {
    const ids = (body: string) => findMentions(body).map((mention) => mention.id);
    expect(ids("\\[[HM-1]] \\\\[[HM-2]] \\\\\\[[HM-3]]"), "odd backslashes escape").toEqual([
      "HM-2",
    ]);
    expect(ids("para\n\n    [[HM-1]]\n\tstill code [[HM-2]]\n\nback [[HM-3]]")).toEqual(["HM-3"]);
    expect(ids("para\n    [[HM-1]] continues it"), "no code inside a paragraph").toEqual(["HM-1"]);
    expect(ids("- item\n\n    more [[HM-1]] in the item"), "a list item's paragraph").toEqual([
      "HM-1",
    ]);
    expect(ids("<!-- [[HM-1]] -->[[HM-2]]<!--\n[[HM-3]]\n-->\n<!-- [[HM-4]]")).toEqual(["HM-2"]);
    expect(ids("```\n```js\n[[HM-1]]\n```\n[[HM-2]]"), "a fence closes without info").toEqual([
      "HM-2",
    ]);
    expect(ids("\\`[[HM-1]]` and ``[[HM-2]]`` \\``[[HM-3]]`"), "an escaped backtick").toEqual([
      "HM-1",
    ]);
  });

  it("treats an unmatched backtick as text", () => {
    expect(findMentions("a ` b [[HM-1]]").map((mention) => mention.id)).toEqual(["HM-1"]);
  });
});

describe("link fields in task.md", () => {
  const readTask = (text: string) => {
    const result = readTaskFile(text, place);
    if (result._tag !== "Read") throw new Error(`Expected a task, got ${result._tag}`);
    return result;
  };

  it("reads blocked_by as ids, each once, and the body's mentions each once", () => {
    const result = readTask(
      taskFile("HM-1", "blocked_by: [HM-3, HM-7, HM-3]\n", "\n[[HM-5]] then [[HM-2]] [[HM-5]]\n"),
    );
    expect(result.value.blockedBy).toEqual(["HM-3", "HM-7"]);
    expect(result.value.mentions).toEqual(["HM-5", "HM-2"]);
    expect(result.value.extra).toEqual({});
    expect(result.problems).toEqual([]);
  });

  it.each([
    ["blocked_by: [[HM-3]]\n", true],
    ["blocked_by: HM-3\n", true],
    ["blocked_by: [HM-3, 4]\n", false],
  ])("reads the ids out of the malformed field %j and says it is malformed", (field, fixable) => {
    const result = readTask(taskFile("HM-1", field));
    expect(result.value.blockedBy).toEqual(["HM-3"]);
    expect(result.problems).toMatchObject([{ kind: "malformed-link", field: "blocked_by" }]);
    expect(result.problems[0]!.fix !== null, "a rewrite is offered when it loses nothing").toBe(
      fixable,
    );
  });

  it("reads no ids out of a field that holds none, and offers no rewrite that would lose it", () => {
    const result = readTask(taskFile("HM-1", "blocked_by: {a: 1}\n"));
    expect(result.value.blockedBy).toEqual([]);
    expect(result.problems).toMatchObject([{ kind: "malformed-link", fix: null }]);
  });

  it("leaves the task itself out of its links and says so", () => {
    const result = readTask(taskFile("HM-1", "blocked_by: [HM-1, HM-2]\n"));
    expect(result.value.blockedBy).toEqual(["HM-2"]);
    expect(result.problems).toMatchObject([{ kind: "self-link", field: "blocked_by" }]);
  });

  it("writes blocked_by as a flow list of ids and removes the key when empty", () => {
    const text = taskFile("HM-1", "estimate: 3 # hours\n");
    const linked = editTaskFile(text, { blocked_by: ["HM-3", "HM-7"] });
    expect(linked).toBe(
      "---\nid: HM-1\ntitle: Task HM-1\nestimate: 3 # hours\nblocked_by: [HM-3, HM-7]\n---\n",
    );
    expect(editTaskFile(linked, { blocked_by: [] })).toBe(
      "---\nid: HM-1\ntitle: Task HM-1\nestimate: 3 # hours\n---\n",
    );
  });

  it("keeps the ids a link field holds that pass, and leaves a field it would not change alone", () => {
    const text = taskFile("HM-1", "blocked_by: [HM-3, HM-7]\n", "\nAfter [[HM-3]]\n");
    const without = (ids: ReadonlyArray<string>) =>
      keepLinks(text, "blocked_by", (id) => !ids.includes(id), "HM");
    expect(without(["HM-3"])).toBe(
      "---\nid: HM-1\ntitle: Task HM-1\nblocked_by: [HM-7]\n---\n\nAfter [[HM-3]]\n",
    );
    expect(without(["HM-3", "HM-7"])).not.toContain("blocked_by");
    expect(without(["HM-9"])).toBeNull();
    expect(keepLinks(taskFile("HM-1"), "blocked_by", () => false, "HM")).toBeNull();
    expect(keepLinks("---\ntitle: [unclosed\n---\n", "blocked_by", () => false, "HM")).toBeNull();
  });

  it.each([
    ["blocked_by: [[HM-3]]\n", "blocked_by: [HM-3]\n"],
    ["blocked_by: HM-3\n", "blocked_by: [HM-3]\n"],
  ])("rewrites the malformed field %j as a list of the ids in it", (field, written) => {
    expect(keepLinks(taskFile("HM-1", field), "blocked_by", () => true, "HM")).toBe(
      taskFile("HM-1", written),
    );
  });
});

describe("links in a workspace", () => {
  it("computes blocks, blocked and mentioned in when the snapshot is read", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.snapshot;
        write(root, "HM-1/task.md", taskFile("HM-1", "status: done\n"));
        write(root, "HM-2/task.md", taskFile("HM-2", "status: archived\n"));
        write(root, "HM-3/task.md", taskFile("HM-3", "blocked_by: [HM-1, HM-2]\n"));
        write(root, "HM-4/task.md", taskFile("HM-4", "blocked_by: [HM-1, HM-3]\n"));
        write(root, "HM-5/task.md", taskFile("HM-5", "", "\nAfter [[HM-4]] and [[HM-5]]\n"));
        write(root, "HM-5/HM-6/task.md", taskFile("HM-6", "", "\nSee [[HM-4]], `[[HM-1]]`\n"));
        return yield* (yield* makeWorkspace("again", root)).snapshot;
      }),
    );
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    expect(byId.get("HM-1")).toMatchObject({ blocks: ["HM-3", "HM-4"], blocked: false });
    expect(byId.get("HM-3")).toMatchObject({ blockedBy: ["HM-1", "HM-2"], blocked: false });
    expect(byId.get("HM-3")!.blocks).toEqual(["HM-4"]);
    expect(byId.get("HM-4")).toMatchObject({ blockedBy: ["HM-1", "HM-3"], blocked: true });
    expect(byId.get("HM-4")!.mentionedIn).toEqual(["HM-5", "HM-6"]);
    expect(byId.get("HM-5")).toMatchObject({ mentions: ["HM-4", "HM-5"], mentionedIn: [] });
    expect(byId.get("HM-1")!.mentionedIn).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("reads links that do not hold as diagnostics, and an unknown blocker blocks", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        yield* ws.snapshot;
        write(root, "HM-1/task.md", taskFile("HM-1", "blocked_by: [HM-99]\n", "\n[[HM-98]]\n"));
        write(root, "HM-2/task.md", taskFile("HM-2", "blocked_by: [[HM-1]]\n"));
        write(root, "HM-3/task.md", taskFile("HM-3", "blocked_by: [HM-3]\n"));
        return yield* (yield* makeWorkspace("again", root)).snapshot;
      }),
    );
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    expect(byId.get("HM-1")).toMatchObject({ blockedBy: ["HM-99"], blocked: true });
    expect(byId.get("HM-1")!.mentions).toEqual(["HM-98"]);
    expect(byId.get("HM-2")).toMatchObject({ blockedBy: ["HM-1"], blocked: true });
    expect(byId.get("HM-3")).toMatchObject({ blockedBy: [], blocked: false, blocks: [] });
    expect(
      snapshot.diagnostics.map(({ path, kind, field, fix }) => [path, kind, field, fix?.action]),
    ).toEqual([
      [".octodo/HM-2/task.md", "malformed-link", "blocked_by", "normalize-links"],
      [".octodo/HM-3/task.md", "self-link", "blocked_by", "drop-self-link"],
      [".octodo/HM-1/task.md", "broken-link", "blocked_by", "drop-unknown-links"],
    ]);
  });

  it("writes blocked_by through update and refuses unknown ids and the task itself", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const paint = yield* ws.createTask({ title: "Paint" });
        const primer = yield* ws.createTask({ title: "Buy primer" });
        const linked = yield* ws.updateTask(paint.id, { blocked_by: [primer.id, primer.id] });
        const file = read(root, linked.path);
        const unknown = yield* Effect.flip(ws.updateTask(paint.id, { blocked_by: ["HM-9"] }));
        const self = yield* Effect.flip(ws.updateTask(paint.id, { blocked_by: [paint.id] }));
        const blocker = yield* ws.getTask(primer.id);
        yield* ws.moveTask(primer.id, { status: "done" });
        const unblocked = yield* ws.getTask(paint.id);
        const cleared = yield* ws.updateTask(paint.id, { blocked_by: [] });
        return { linked, file, unknown, self, blocker, unblocked, cleared };
      }),
    );
    expect(result.linked).toMatchObject({ blockedBy: ["HM-2"], blocked: true });
    expect(result.file).toContain("\nblocked_by: [HM-2]\n");
    expect(result.unknown).toMatchObject({ _tag: "InvalidRequest" });
    expect(result.self).toMatchObject({ _tag: "InvalidRequest" });
    expect(result.blocker.blocks).toEqual(["HM-1"]);
    expect(result.unblocked).toMatchObject({ blockedBy: ["HM-2"], blocked: false });
    expect(result.cleared.blockedBy).toEqual([]);
    expect(read(root, result.cleared.path)).not.toContain("blocked_by");
  });

  it("lets an update keep or drop blockers that match no task, and refuses only new unknown ids", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const primer = yield* ws.createTask({ title: "Buy primer" });
        write(root, "HM-2/task.md", taskFile("HM-2", "blocked_by: [HM-1, HM-98, HM-99]\n"));
        yield* (yield* makeWorkspace("again", root)).snapshot;
        const fresh = yield* makeWorkspace("fresh", root);
        const droppedValid = yield* fresh.updateTask("HM-2", { blocked_by: ["HM-98", "HM-99"] });
        const droppedDangling = yield* fresh.updateTask("HM-2", { blocked_by: ["HM-98"] });
        const added = yield* Effect.flip(
          fresh.updateTask("HM-2", { blocked_by: ["HM-98", "HM-97"] }),
        );
        const relinked = yield* fresh.updateTask("HM-2", { blocked_by: ["HM-98", primer.id] });
        return { droppedValid, droppedDangling, added, relinked };
      }),
    );
    expect(result.droppedValid.blockedBy).toEqual(["HM-98", "HM-99"]);
    expect(result.droppedDangling.blockedBy).toEqual(["HM-98"]);
    expect(result.added).toMatchObject({ _tag: "InvalidRequest", message: "Unknown task HM-97" });
    expect(result.relinked.blockedBy).toEqual(["HM-98", "HM-1"]);
  });

  it("deletes a task's id, and its subtasks' ids, from other tasks' links but not their bodies", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const gone = yield* ws.createTask({ title: "Gone" });
        const sub = yield* ws.createTask({ title: "Gone too", parent: gone.id });
        const keep = yield* ws.createTask({ title: "Keep" });
        const waiting = yield* ws.createTask({ title: "Waiting", body: `After [[${gone.id}]]` });
        yield* ws.updateTask(waiting.id, { blocked_by: [gone.id, sub.id, keep.id] });
        const bystander = yield* ws.createTask({ title: "Bystander" });
        yield* ws.updateTask(bystander.id, { blocked_by: [keep.id] });
        const before = read(root, (yield* ws.getTask(bystander.id)).path);
        yield* ws.deleteTask(gone.id);
        const snapshot = yield* ws.snapshot;
        return { snapshot, before, waiting: waiting.id, bystander: bystander.id };
      }),
    );
    const byId = new Map(result.snapshot.tasks.map((task) => [task.id, task]));
    const waiting = byId.get(result.waiting)!;
    expect(waiting).toMatchObject({ blockedBy: ["HM-3"], mentions: ["HM-1"] });
    expect(read(root, waiting.path)).toContain("\nblocked_by: [HM-3]\n");
    expect(read(root, waiting.path)).toContain("After [[HM-1]]");
    expect(read(root, byId.get(result.bystander)!.path)).toBe(result.before);
    expect(result.snapshot.diagnostics).toEqual([]);
  });

  it("deletes a blocker after another process moved a task that waits for it", async () => {
    const root = fresh();
    const result = await run(
      Effect.gen(function* () {
        const app = yield* open(root);
        const primer = yield* app.createTask({ title: "Buy primer" });
        const paint = yield* app.createTask({ title: "Paint" });
        yield* app.updateTask(paint.id, { blocked_by: [primer.id] });
        yield* app.createList({ name: "Walls" });
        yield* app.snapshot;
        const cli = yield* makeWorkspace("cli", root);
        yield* cli.moveTask(paint.id, { list: "walls" });
        yield* app.deleteTask(primer.id);
        return yield* (yield* makeWorkspace("check", root)).getTask(paint.id);
      }),
    );
    expect(result).toMatchObject({ list: "walls", blockedBy: [], blocked: false });
    expect(read(root, result.path)).not.toContain("blocked_by");
  });

  it("keeps both tasks of a blocking cycle blocked", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const wall = yield* ws.createTask({ title: "Wall" });
        const door = yield* ws.createTask({ title: "Door" });
        yield* ws.updateTask(wall.id, { blocked_by: [door.id] });
        yield* ws.updateTask(door.id, { blocked_by: [wall.id] });
        return yield* ws.snapshot;
      }),
    );
    expect(snapshot.tasks.map(({ id, blocked, blocks }) => ({ id, blocked, blocks }))).toEqual([
      { id: "HM-1", blocked: true, blocks: ["HM-2"] },
      { id: "HM-2", blocked: true, blocks: ["HM-1"] },
    ]);
    expect(snapshot.tasks.filter((task) => task.ready)).toEqual([]);
  });

  it("finishes a delete that failed partway when it runs again", async () => {
    const root = fresh();
    let renames = 0;
    const failsSecondWrite = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return {
          ...fs,
          rename: (from, to) =>
            to.endsWith("/task.md") && ++renames === 2
              ? fs.rename(from, join(from, "not-a-folder"))
              : fs.rename(from, to),
        };
      }),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    const ids = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const primer = yield* ws.createTask({ title: "Buy primer" });
        const waiting = [];
        for (const title of ["Paint", "Tile", "Trim"]) {
          const task = yield* ws.createTask({ title });
          yield* ws.updateTask(task.id, { blocked_by: [primer.id] });
          waiting.push(task.id);
        }
        return { primer: primer.id, waiting };
      }),
    );
    const failed = await Effect.runPromise(
      Effect.flatMap(makeWorkspace("crashy", root), (ws) =>
        Effect.flip(ws.deleteTask(ids.primer)),
      ).pipe(Effect.scoped, Effect.provide(failsSecondWrite)),
    );
    expect(failed).toMatchObject({ _tag: "StorageError" });
    const partway = await run(Effect.flatMap(makeWorkspace("check", root), (ws) => ws.snapshot));
    expect(
      partway.tasks.map(({ id, blockedBy }) => [id, blockedBy]),
      "the first waiting task was cleaned, the second failed",
    ).toEqual([
      ["HM-1", []],
      ["HM-2", []],
      ["HM-3", ["HM-1"]],
      ["HM-4", ["HM-1"]],
    ]);
    await run(Effect.flatMap(makeWorkspace("again", root), (ws) => ws.deleteTask(ids.primer)));
    const done = await run(Effect.flatMap(makeWorkspace("check", root), (ws) => ws.snapshot));
    expect(done.tasks.map(({ id, blockedBy, blocked }) => ({ id, blockedBy, blocked }))).toEqual(
      ids.waiting.map((id) => ({ id, blockedBy: [], blocked: false })),
    );
    expect(done.diagnostics).toEqual([]);
  });

  it("counts a task as ready when it is open and not blocked", async () => {
    const root = fresh();
    const snapshot = await run(
      Effect.gen(function* () {
        const ws = yield* open(root);
        const blocker = yield* ws.createTask({ title: "Open" });
        const waiting = yield* ws.createTask({ title: "Waiting" });
        yield* ws.updateTask(waiting.id, { blocked_by: [blocker.id] });
        yield* ws.createTask({ title: "Done", status: "done" });
        yield* ws.createTask({ title: "Archived", status: "archived" });
        return yield* ws.snapshot;
      }),
    );
    expect(snapshot.tasks.map(({ title, blocked, ready }) => ({ title, blocked, ready }))).toEqual([
      { title: "Open", blocked: false, ready: true },
      { title: "Waiting", blocked: true, ready: false },
      { title: "Done", blocked: false, ready: false },
      { title: "Archived", blocked: false, ready: false },
    ]);
  });
});
