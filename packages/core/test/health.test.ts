import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Schema } from "effect";
import {
  chmodSync,
  existsSync,
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
import {
  CreateTaskInput,
  type Diagnostic,
  type DiagnosticKind,
  type FixAction,
  type FixRequest,
} from "../src/domain.ts";
import { initWorkspace, makeWorkspace, type Workspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

const fresh = async (files: Record<string, string>) => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  for (const [file, content] of Object.entries(files)) write(root, file, content);
  return root;
};

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
  writeFileSync(join(root, ".octodo", file), content);
};

const read = (root: string, file: string) => readFileSync(join(root, ".octodo", file), "utf8");

/** Every file under `.octodo/` but its `.gitignore`, relative to it and sorted. */
const files = (root: string) =>
  readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" })
    .filter((entry) => statSync(join(root, ".octodo", entry)).isFile() && entry !== ".gitignore")
    .toSorted();

const inWorkspace = <A>(root: string, use: (ws: Workspace) => Effect.Effect<A, unknown>) =>
  run(Effect.flatMap(makeWorkspace("test", root), use));

const snapshot = (root: string) => inWorkspace(root, (ws) => ws.snapshot);

const summary = (diagnostic: Diagnostic) => ({
  path: diagnostic.path,
  kind: diagnostic.kind,
  field: diagnostic.field,
  fix: diagnostic.fix?.action ?? null,
});

/** The diagnostics by path, then kind: their order is not part of the contract. */
const diagnostics = async (root: string) =>
  (await snapshot(root)).diagnostics
    .map(summary)
    .toSorted((a, b) => (`${a.path} ${a.kind}` < `${b.path} ${b.kind}` ? -1 : 1));

/** Fixes `request` twice: the second run must find nothing to do and leave the files as they were. */
const fixTwice = async (root: string, request: FixRequest) => {
  const first = await inWorkspace(root, (ws) => ws.fixDiagnostic(request));
  const after = Object.fromEntries(files(root).map((file) => [file, read(root, file)]));
  const second = await inWorkspace(root, (ws) => ws.fixDiagnostic(request));
  expect(second.fixed, "a repeated fix does nothing").toEqual([]);
  expect(
    Object.fromEntries(files(root).map((file) => [file, read(root, file)])),
    "a repeated fix leaves the files as they were",
  ).toEqual(after);
  return first;
};

const one = (
  path: string,
  kind: DiagnosticKind,
  field: string | null,
  fix: FixAction | null,
): ReturnType<typeof summary> => ({ path: `.octodo/${path}`, kind, field, fix });

describe("file health", () => {
  it("reports bad optional fields, keeps the task with their defaults, and offers no fix", async () => {
    const root = await fresh({
      "HM-1-a/task.md":
        "---\nid: HM-1\ntitle: A\npriority: critical\ndue: next week\ntags: {a: 1}\n---\n",
    });
    const { tasks } = await snapshot(root);
    expect(tasks).toMatchObject([
      { id: "HM-1", title: "A", priority: "none", due: null, tags: [] },
    ]);
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "invalid-due", "due", null),
      one("HM-1-a/task.md", "invalid-tags", "tags", null),
      one("HM-1-a/task.md", "unknown-priority", "priority", null),
    ]);
    const before = read(root, "HM-1-a/task.md");
    const result = await fixTwice(root, {
      path: ".octodo/HM-1-a/task.md",
      kind: "invalid-due",
      action: "normalize-links",
    });
    expect(result.fixed).toEqual([]);
    expect(read(root, "HM-1-a/task.md")).toBe(before);
  });

  it("reads numeric tags and a due date-time as written, and reports an impossible date", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\ntags: [2026, q4, true]\ndue: 2026-11-01T10:00\n---\n",
      "HM-2-b/task.md": "---\nid: HM-2\ndue: 2026-02-31\n---\n",
    });
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.tags, task.due])).toEqual([
      ["HM-1", ["2026", "q4", "true"], "2026-11-01T10:00"],
      ["HM-2", [], null],
    ]);
    expect(await diagnostics(root)).toEqual([one("HM-2-b/task.md", "invalid-due", "due", null)]);
    const input = Schema.decodeUnknownExit(CreateTaskInput);
    const accepts = (due: string) => [due, Exit.isSuccess(input({ title: "C", due }))];
    expect(
      ["2026-11-01", "2026-11-01T10:00", "2026-11-01T10:00:30+02:00", "2028-02-29"].map(accepts),
    ).toEqual([
      ["2026-11-01", true],
      ["2026-11-01T10:00", true],
      ["2026-11-01T10:00:30+02:00", true],
      ["2028-02-29", true],
    ]);
    expect(
      ["2026-02-31", "2027-02-29", "2026-11-01T24:00", "2026-11-01 10:00"].map(accepts),
    ).toEqual([
      ["2026-02-31", false],
      ["2027-02-29", false],
      ["2026-11-01T24:00", false],
      ["2026-11-01 10:00", false],
    ]);
    const created = await inWorkspace(root, (ws) =>
      ws.createTask({ title: "C", due: "2026-11-01T10:00Z" }),
    );
    expect(created.due).toBe("2026-11-01T10:00Z");
  });

  it("skips a task whose frontmatter does not parse or whose id is malformed, and says so", async () => {
    const root = await fresh({
      "broken/task.md": "---\ntitle: [unclosed\n---\n",
      "number/task.md": "---\nid: 42\n---\n",
      "word/task.md": "---\nid: groceries\n---\n",
      "HM-1-ok/task.md": "---\nid: HM-1\n---\n",
    });
    expect((await snapshot(root)).tasks.map((task) => task.id)).toEqual(["HM-1"]);
    expect(await diagnostics(root)).toEqual([
      one("broken/task.md", "invalid-frontmatter", null, null),
      one("number/task.md", "malformed-id", "id", null),
      one("word/task.md", "malformed-id", "id", null),
    ]);
  });

  it("loads a task whose id has another workspace's key and reports it", async () => {
    const root = await fresh({ "XY-4-a/task.md": "---\nid: XY-4\n---\n" });
    expect((await snapshot(root)).tasks.map((task) => task.id)).toEqual(["XY-4"]);
    expect(await diagnostics(root)).toEqual([one("XY-4-a/task.md", "foreign-id", "id", null)]);
  });

  it("gives a copied task folder and its copied subtasks new ids and renames them in one fix", async () => {
    const root = await fresh({
      "HM-1-paint/task.md": "---\nid: HM-1\ntitle: Paint\n---\n",
      "HM-1-paint/HM-2-primer/task.md": "---\nid: HM-2\n---\n",
      "HM-1-paint-copy/task.md": "---\nid: HM-1\ntitle: Paint\n---\n",
      "HM-1-paint-copy/HM-2-primer/task.md": "---\nid: HM-2\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-paint-copy/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
    const result = await fixTwice(root, {
      path: ".octodo/HM-1-paint-copy/task.md",
      kind: "duplicate-id",
      action: "fresh-id",
    });
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-paint-copy/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
    expect(read(root, "HM-3-paint-copy/task.md")).toBe("---\nid: HM-3\ntitle: Paint\n---\n");
    expect(read(root, "HM-3-paint-copy/HM-4-primer/task.md")).toBe("---\nid: HM-4\n---\n");
    expect(result.diagnostics).toEqual([]);
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.parent])).toEqual([
      ["HM-1", null],
      ["HM-2", "HM-1"],
      ["HM-3", null],
      ["HM-4", "HM-3"],
    ]);
  });

  it("renames a copy's folder only where its name starts with the whole old id", async () => {
    const root = await fresh({
      "HM-1-y/task.md": "---\nid: HM-1\ntitle: Y\n---\n",
      "HM-10-x/task.md": "---\nid: HM-1\ntitle: X\n---\n",
    });
    await fixTwice(root, {
      path: ".octodo/HM-10-x/task.md",
      kind: "duplicate-id",
      action: "fresh-id",
    });
    expect(files(root)).toEqual(["HM-1-y/task.md", "HM-10-x/task.md", "config.json"]);
    expect(read(root, "HM-10-x/task.md")).toBe("---\nid: HM-2\ntitle: X\n---\n");
  });

  it("serves the original of a duplicate even when the copy sorts first", async () => {
    const root = await fresh({
      "HM-1-paint-walls/task.md": "---\nid: HM-1\ntitle: Paint walls\n---\n",
      "HM-1-old-name 2/task.md": "---\nid: HM-1\ntitle: Old name\n---\n",
      "HM-2-tile/task.md": "---\nid: HM-2\ntitle: Tile\n---\n",
      "HM-2-copy-of-tile/task.md": "---\nid: HM-2\ntitle: Tile\n---\n",
    });
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.path])).toEqual([
      ["HM-1", ".octodo/HM-1-paint-walls/task.md"],
      ["HM-2", ".octodo/HM-2-tile/task.md"],
    ]);
    expect(await diagnostics(root)).toEqual([
      one("HM-1-old-name 2", "conflict-copy", null, "keep-copy"),
      one("HM-2-copy-of-tile/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
  });

  it("keeps a conflict copy of a task with subtasks without renumbering the original's", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-8]\n---\n",
      "HM-9-x/task.md": "---\nid: HM-9\ntitle: X\n---\nOne.\n",
      "HM-9-x/HM-8-sub/task.md": "---\nid: HM-8\ntitle: Sub\n---\nOriginal.\n",
      "HM-9-x 2/task.md": "---\nid: HM-9\ntitle: X\n---\nTwo.\n",
      "HM-9-x 2/HM-8-sub/task.md": "---\nid: HM-8\ntitle: Sub\n---\nCopy.\n",
    });
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed.map(summary)).toEqual([
      one("HM-9-x 2", "conflict-copy", null, "keep-copy"),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(
      (await snapshot(root)).tasks.map((task) => [task.id, task.parent, task.path, task.body]),
    ).toEqual([
      ["HM-1", null, ".octodo/HM-1-a/task.md", ""],
      ["HM-8", "HM-9", ".octodo/HM-9-x/HM-8-sub/task.md", "Original.\n"],
      ["HM-9", null, ".octodo/HM-9-x/task.md", "One.\n"],
      ["HM-10", null, ".octodo/HM-10-x/task.md", "Two.\n"],
      ["HM-11", "HM-10", ".octodo/HM-10-x/HM-11-sub/task.md", "Copy.\n"],
    ]);
  });

  it("refuses a key ids cannot use, and still serves a workspace that has one", async () => {
    const empty = join(mkdtempSync(join(tmpdir(), "octodo-")), "keyed");
    mkdirSync(empty);
    await expect(run(initWorkspace(empty, { key: "MY_K" }))).rejects.toMatchObject({
      _tag: "InvalidRequest",
    });
    expect(existsSync(join(empty, ".octodo")), "nothing is created").toBe(false);
    const root = await fresh({
      "MY_K-1-a/task.md": "---\nid: MY_K-1\nblocked_by: [MY_K-2]\n---\n",
      "MY_K-2-b/task.md": "---\nid: MY_K-2\n---\n",
    });
    const config = JSON.parse(read(root, "config.json"));
    write(root, "config.json", JSON.stringify({ ...config, key: "MY_K" }));
    const created = await inWorkspace(root, (ws) => ws.createTask({ title: "C" }));
    expect(created.id).toBe("MY_K-3");
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.blockedBy])).toEqual([
      ["MY_K-1", ["MY_K-2"]],
      ["MY_K-2", []],
      ["MY_K-3", []],
    ]);
    const found = (await snapshot(root)).diagnostics;
    expect(found.map(summary)).toEqual([one("config.json", "invalid-config", "key", null)]);
    expect(found[0]?.message).toContain('set "key" in config.json to letters and digits');
  });

  it("adds an unknown status to config.json as unstarted only when asked", async () => {
    const root = await fresh({ "HM-1-a/task.md": "---\nid: HM-1\nstatus: in-review\n---\n" });
    const config = read(root, "config.json");
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "unknown-status", "status", "add-status"),
    ]);
    expect(read(root, "config.json"), "reading never adds it").toBe(config);
    await fixTwice(root, {
      path: ".octodo/HM-1-a/task.md",
      kind: "unknown-status",
      action: "add-status",
    });
    expect(JSON.parse(read(root, "config.json")).statuses.at(-1)).toEqual({
      id: "in-review",
      name: "In Review",
      category: "unstarted",
    });
    expect(await diagnostics(root)).toEqual([]);
  });

  it("wraps a loose markdown file as a task folder with an id", async () => {
    const root = await fresh({
      "home/list.md": "",
      "home/notes.md": "---\ntitle: Measure the hall\n---\nTape.\n",
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("home/notes.md", "loose-markdown", null, "wrap-as-task"),
    ]);
    await fixTwice(root, {
      path: ".octodo/home/notes.md",
      kind: "loose-markdown",
      action: "wrap-as-task",
    });
    expect(files(root)).toEqual([
      "HM-1-a/task.md",
      "config.json",
      "home/HM-2-measure-the-hall/task.md",
      "home/list.md",
    ]);
    expect(read(root, "home/HM-2-measure-the-hall/task.md")).toBe(
      "---\ntitle: Measure the hall\nid: HM-2\n---\n\nTape.\n",
    );
    expect((await snapshot(root)).tasks.find((task) => task.id === "HM-2")).toMatchObject({
      list: "home",
      title: "Measure the hall",
    });
  });

  it("offers to delete a loose file that is an exact copy of the task its id names", async () => {
    const task = "---\nid: HM-1\ntitle: A\n---\n";
    const root = await fresh({ "HM-1-a/task.md": task, "HM-1-a.md": task });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a.md", "loose-markdown", null, "remove-copy"),
    ]);
    await fixTwice(root, {
      path: ".octodo/HM-1-a.md",
      kind: "loose-markdown",
      action: "remove-copy",
    });
    expect(files(root)).toEqual(["HM-1-a/task.md", "config.json"]);
  });

  it("keeps a conflict copy of task.md as a new task next to the original, or deletes an identical one", async () => {
    const root = await fresh({
      "home/list.md": "",
      "home/HM-1-paint/task.md": "---\nid: HM-1\ntitle: Paint\n---\nTwo coats.\n",
      "home/HM-1-paint/task 2.md": "---\nid: HM-1\ntitle: Paint\n---\nThree coats.\n",
      "HM-2-b/task.md": "---\nid: HM-2\n---\n",
      "HM-2-b/task 3.md": "---\nid: HM-2\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-2-b/task 3.md", "conflict-copy", null, "remove-copy"),
      one("home/HM-1-paint/task 2.md", "conflict-copy", null, "keep-copy"),
    ]);
    await fixTwice(root, {
      path: ".octodo/home/HM-1-paint/task 2.md",
      kind: "conflict-copy",
      action: "keep-copy",
    });
    await fixTwice(root, {
      path: ".octodo/HM-2-b/task 3.md",
      kind: "conflict-copy",
      action: "remove-copy",
    });
    expect(files(root)).toEqual([
      "HM-2-b/task.md",
      "config.json",
      "home/HM-1-paint/task.md",
      "home/HM-3-paint/task.md",
      "home/list.md",
    ]);
    expect(read(root, "home/HM-3-paint/task.md")).toBe(
      "---\nid: HM-3\ntitle: Paint\n---\n\nThree coats.\n",
    );
    expect(await diagnostics(root)).toEqual([]);
  });

  it("resolves a conflict copy of a task folder by its contents", async () => {
    const root = await fresh({
      "HM-1-paint/task.md": "---\nid: HM-1\n---\n",
      "HM-1-paint/images/plan.png": "png",
      "HM-1-paint 2/task.md": "---\nid: HM-1\n---\n",
      "HM-1-paint 2/images/plan.png": "png",
      "HM-2-tile/task.md": "---\nid: HM-2\n---\nGrey.\n",
      "HM-2-tile 2/task.md": "---\nid: HM-2\n---\nWhite.\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-paint 2", "conflict-copy", null, "remove-copy"),
      one("HM-2-tile 2", "conflict-copy", null, "keep-copy"),
    ]);
    await fixTwice(root, {
      path: ".octodo/HM-1-paint 2",
      kind: "conflict-copy",
      action: "remove-copy",
    });
    await fixTwice(root, {
      path: ".octodo/HM-2-tile 2",
      kind: "conflict-copy",
      action: "keep-copy",
    });
    expect(files(root)).toEqual([
      "HM-1-paint/images/plan.png",
      "HM-1-paint/task.md",
      "HM-2-tile/task.md",
      "HM-3-tile/task.md",
      "config.json",
    ]);
    expect(read(root, "HM-3-tile/task.md")).toBe("---\nid: HM-3\n---\n\nWhite.\n");
  });

  it("refuses a fix whose action is not the one a fresh read offers", async () => {
    const root = await fresh({
      "HM-2-tile/task.md": "---\nid: HM-2\n---\nGrey.\n",
      "HM-2-tile 2/task.md": "---\nid: HM-2\n---\nGrey.\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-2-tile 2", "conflict-copy", null, "remove-copy"),
    ]);
    write(root, "HM-2-tile 2/task.md", "---\nid: HM-2\n---\nWhite.\n");
    const stale = await inWorkspace(root, (ws) =>
      ws.fixDiagnostic({
        path: ".octodo/HM-2-tile 2",
        kind: "conflict-copy",
        action: "remove-copy",
      }),
    );
    expect(stale.fixed).toEqual([]);
    expect(stale.diagnostics.map(summary)).toEqual([
      one("HM-2-tile 2", "conflict-copy", null, "keep-copy"),
    ]);
    expect(read(root, "HM-2-tile 2/task.md")).toBe("---\nid: HM-2\n---\nWhite.\n");
  });

  it("deletes a conflict copy of list.md only when it is identical", async () => {
    const root = await fresh({
      "home/list.md": "---\nname: Home\n---\n",
      "home/list 2.md": "---\nname: Home\n---\n",
      "garden/list.md": "---\nname: Garden\n---\n",
      "garden/list 2.md": "---\nname: Yard\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("garden/list 2.md", "conflict-copy", null, null),
      one("home/list 2.md", "conflict-copy", null, "remove-copy"),
    ]);
    await fixTwice(root, {
      path: ".octodo/home/list 2.md",
      kind: "conflict-copy",
      action: "remove-copy",
    });
    await fixTwice(root, {
      path: ".octodo/garden/list 2.md",
      kind: "conflict-copy",
      action: "remove-copy",
    });
    expect(files(root)).toEqual([
      "config.json",
      "garden/list 2.md",
      "garden/list.md",
      "home/list.md",
    ]);
  });

  it("migrates the old layout when asked", async () => {
    const root = await fresh({ "s01-todo/HM-1-a.md": "---\nid: HM-1\n---\n" });
    expect(await diagnostics(root)).toEqual([
      { path: ".octodo", kind: "old-layout", field: null, fix: "migrate" },
    ]);
    await fixTwice(root, { path: ".octodo", kind: "old-layout", action: "migrate" });
    expect(files(root)).toEqual(["HM-1-a/task.md", "config.json"]);
    expect(read(root, "HM-1-a/task.md")).toBe("---\nid: HM-1\nstatus: todo\n---\n");
  });

  it("reports a task it cannot give an id, and gives it one on the next read that can", async () => {
    const root = await fresh({ "frozen/task.md": "No id yet\n" });
    chmodSync(join(root, ".octodo/frozen"), 0o555);
    try {
      expect(await diagnostics(root)).toEqual([one("frozen/task.md", "missing-id", "id", null)]);
    } finally {
      chmodSync(join(root, ".octodo/frozen"), 0o755);
    }
    expect(await diagnostics(root)).toEqual([]);
    expect(read(root, "frozen/task.md")).toBe("---\nid: HM-1\n---\n\nNo id yet\n");
  });

  it("drops a blocker that matches no task, and the next run finds nothing to do", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-2, HM-9] # waits\nnote: kept\n---\n",
      "HM-2-b/task.md": "---\nid: HM-2\n---\n",
    });
    expect((await snapshot(root)).tasks[0]).toMatchObject({ id: "HM-1", blocked: true });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "broken-link", "blocked_by", "drop-unknown-links"),
    ]);
    const result = await fixTwice(root, {
      path: ".octodo/HM-1-a/task.md",
      kind: "broken-link",
      action: "drop-unknown-links",
    });
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-a/task.md", "broken-link", "blocked_by", "drop-unknown-links"),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(read(root, "HM-1-a/task.md")).toBe(
      "---\nid: HM-1\nblocked_by: [HM-2]\nnote: kept\n---\n",
    );
  });

  it("keeps links to tasks that are on disk but cannot be read, and they still block", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-2, HM-3, HM-4, HM-9]\n---\n",
      "HM-2-conflicted/task.md": "---\nid: HM-2\n<<<<<<< ours\ntitle: [x\n---\n",
      "HM-1-a-copy/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a-copy/HM-3-sub/task.md": "---\nid: HM-3\n---\n",
      "loose/HM-4-b/task.md": "---\nid: HM-4\n---\n",
    });
    expect((await snapshot(root)).tasks[0]).toMatchObject({ id: "HM-1", blocked: true });
    const broken = (await diagnostics(root)).filter((found) => found.kind === "broken-link");
    expect(broken).toEqual([
      one("HM-1-a/task.md", "broken-link", "blocked_by", "drop-unknown-links"),
    ]);
    expect(
      (await snapshot(root)).diagnostics.find((found) => found.kind === "broken-link")?.message,
    ).toContain("lists HM-9, which matches no task");
    await inWorkspace(root, (ws) => ws.fixAll);
    expect(read(root, "HM-1-a/task.md")).toContain("blocked_by: [HM-2, HM-3, HM-4]");
  });

  it("drops a task's link to itself, and the next run finds nothing to do", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-1]\n---\nBody\n",
    });
    expect((await snapshot(root)).tasks[0]).toMatchObject({ blockedBy: [], blocked: false });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "self-link", "blocked_by", "drop-self-link"),
    ]);
    const result = await fixTwice(root, {
      path: ".octodo/HM-1-a/task.md",
      kind: "self-link",
      action: "drop-self-link",
    });
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-a/task.md", "self-link", "blocked_by", "drop-self-link"),
    ]);
    expect(read(root, "HM-1-a/task.md")).toBe("---\nid: HM-1\n---\n\nBody\n");
  });

  it("rewrites a link field as a list of ids only when that loses nothing", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [[HM-2]]\n---\n",
      "HM-2-b/task.md": "---\nid: HM-2\nblocked_by: [HM-1, 7]\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "malformed-link", "blocked_by", "normalize-links"),
      one("HM-2-b/task.md", "malformed-link", "blocked_by", null),
    ]);
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-a/task.md", "malformed-link", "blocked_by", "normalize-links"),
    ]);
    expect(read(root, "HM-1-a/task.md")).toBe("---\nid: HM-1\nblocked_by: [HM-2]\n---\n");
    expect(read(root, "HM-2-b/task.md")).toBe("---\nid: HM-2\nblocked_by: [HM-1, 7]\n---\n");
  });

  it("reads the ids in a hand-written string of blockers and writes them as a list", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: HM-2, HM-3\n---\n",
      "HM-2-b/task.md": "---\nid: HM-2\n---\n",
      "HM-3-c/task.md": "---\nid: HM-3\nblocked_by: HM-2 after lunch\n---\n",
    });
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.blockedBy])).toEqual([
      ["HM-1", ["HM-2", "HM-3"]],
      ["HM-2", []],
      ["HM-3", ["HM-2"]],
    ]);
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "malformed-link", "blocked_by", "normalize-links"),
      one("HM-3-c/task.md", "malformed-link", "blocked_by", null),
    ]);
    await inWorkspace(root, (ws) => ws.fixAll);
    expect(read(root, "HM-1-a/task.md")).toBe("---\nid: HM-1\nblocked_by: [HM-2, HM-3]\n---\n");
    expect(read(root, "HM-3-c/task.md")).toBe("---\nid: HM-3\nblocked_by: HM-2 after lunch\n---\n");
  });

  it("never reports or serves octodo's own claim and pending-id files", async () => {
    const root = await fresh({
      ".claim-HM-7": "",
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a/.pending-id": "HM-1\n",
      "HM-1-a 2/task.md": "---\nid: HM-1\n---\n",
      "home/list.md": "",
      "home/.claim-HM-8": "",
      "empty/.pending-id": "HM-9\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a 2", "conflict-copy", null, "remove-copy"),
      one("empty", "unmarked-folder", null, null),
    ]);
    const served = await inWorkspace(root, (ws) =>
      Effect.flip(ws.attachmentPath("HM-1", ".pending-id")),
    );
    expect(served).toMatchObject({ _tag: "InvalidRequest" });
  });

  it("removes a pending-id marker beside a task that has its id, however fresh", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a/.pending-id": "HM-1\n",
    });
    expect(await diagnostics(root)).toEqual([]);
    expect(existsSync(join(root, ".octodo/HM-1-a/.pending-id"))).toBe(false);
  });

  it("reports folder-grammar problems without a fix", async () => {
    const root = await fresh({
      "random/readme.txt": "",
      "both/task.md": "---\nid: HM-1\n---\n",
      "both/list.md": "",
      "HM-2-a/task.md": "---\nid: HM-2\n---\n",
      "HM-2-a/shopping/list.md": "",
      "a/list.md": "",
      "a/b/list.md": "",
      "a/b/c/list.md": "",
      "a/b/c/d/list.md": "",
    });
    expect(await diagnostics(root)).toEqual([
      one("HM-2-a/shopping", "list-in-task", null, null),
      one("a/b/c/d", "list-too-deep", null, null),
      one("both", "both-markers", null, null),
      one("random", "unmarked-folder", null, null),
    ]);
  });

  it("fixes everything fixable at once and changes nothing for a stale request", async () => {
    const root = await fresh({
      "home/list.md": "",
      "home/notes.md": "Loose\n",
      "HM-1-a/task.md": "---\nid: HM-1\nstatus: in-review\n---\n",
      "HM-1-a/task 2.md": "---\nid: HM-1\nstatus: in-review\n---\nOther\n",
      "HM-1-b/task.md": "---\nid: HM-1\n---\n",
      "broken/task.md": "---\nid: [\n---\n",
    });
    const stale = await inWorkspace(root, (ws) =>
      ws.fixDiagnostic({
        path: ".octodo/HM-1-a/task.md",
        kind: "duplicate-id",
        action: "fresh-id",
      }),
    );
    expect(stale.fixed).toEqual([]);
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed.map((diagnostic) => diagnostic.kind).toSorted()).toEqual([
      "conflict-copy",
      "duplicate-id",
      "loose-markdown",
      "unknown-status",
    ]);
    expect(result.failed).toEqual([]);
    expect(result.diagnostics.map(summary)).toEqual([
      one("broken/task.md", "invalid-frontmatter", null, null),
    ]);
    expect((await inWorkspace(root, (ws) => ws.fixAll)).fixed).toEqual([]);
    expect(existsSync(join(root, ".octodo/home/notes.md"))).toBe(false);
  });
});
