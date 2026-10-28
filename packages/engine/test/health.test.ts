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
  symlinkSync,
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
} from "@octodo/contract";
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

/** Where the test's `file` is: config.json in `.octodo/`, anything else in `.octodo/tasks/`. */
const shown = (file: string) => (file === "config.json" ? file : `tasks/${file}`);

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", shown(file))), { recursive: true });
  writeFileSync(join(root, ".octodo", shown(file)), content);
};

const read = (root: string, file: string) =>
  readFileSync(join(root, ".octodo", shown(file)), "utf8");

const ignored = new Set([".gitignore", ".owner-lock"]);

/** Every file under `.octodo/` but its `.gitignore` and owner lock, as the test names it, sorted. */
const files = (root: string) =>
  readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" })
    .filter((entry) => statSync(join(root, ".octodo", entry)).isFile() && !ignored.has(entry))
    .map((entry) => entry.replace(/^tasks\//, ""))
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
): ReturnType<typeof summary> => ({ path: `.octodo/${shown(path)}`, kind, field, fix });

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
      path: ".octodo/tasks/HM-1-a/task.md",
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
      path: ".octodo/tasks/HM-1-paint-copy/task.md",
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
      path: ".octodo/tasks/HM-10-x/task.md",
      kind: "duplicate-id",
      action: "fresh-id",
    });
    expect(files(root)).toEqual(["HM-1-y/task.md", "HM-10-x/task.md", "config.json"]);
    expect(read(root, "HM-10-x/task.md")).toBe("---\nid: HM-2\ntitle: X\n---\n");
  });

  it("serves the first folder read of several with one id, and reports the others as duplicates", async () => {
    const root = await fresh({
      "HM-1-paint-walls/task.md": "---\nid: HM-1\ntitle: Paint walls\n---\n",
      "HM-1-old-name 2/task.md": "---\nid: HM-1\ntitle: Old name\n---\n",
      "HM-2-tile/task.md": "---\nid: HM-2\ntitle: Tile\n---\n",
      "HM-2-copy-of-tile/task.md": "---\nid: HM-2\ntitle: Tile\n---\n",
    });
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.path])).toEqual([
      ["HM-1", ".octodo/tasks/HM-1-old-name 2/task.md"],
      ["HM-2", ".octodo/tasks/HM-2-copy-of-tile/task.md"],
    ]);
    expect(await diagnostics(root)).toEqual([
      one("HM-1-paint-walls/task.md", "duplicate-id", "id", "fresh-id"),
      one("HM-2-tile/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
  });

  it("gives a sync tool's copy of a task with subtasks new ids, keeping its name and the original's ids", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-8]\n---\n",
      "HM-9-x/task.md": "---\nid: HM-9\ntitle: X\n---\nOne.\n",
      "HM-9-x/HM-8-sub/task.md": "---\nid: HM-8\ntitle: Sub\n---\nOriginal.\n",
      "HM-9-x 2/task.md": "---\nid: HM-9\ntitle: X\n---\nTwo.\n",
      "HM-9-x 2/HM-8-sub/task.md": "---\nid: HM-8\ntitle: Sub\n---\nCopy.\n",
    });
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed.map(summary)).toEqual([
      one("HM-9-x 2/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(
      (await snapshot(root)).tasks.map((task) => [task.id, task.parent, task.path, task.body]),
    ).toEqual([
      ["HM-1", null, ".octodo/tasks/HM-1-a/task.md", ""],
      ["HM-8", "HM-9", ".octodo/tasks/HM-9-x/HM-8-sub/task.md", "Original.\n"],
      ["HM-9", null, ".octodo/tasks/HM-9-x/task.md", "One.\n"],
      ["HM-10", null, ".octodo/tasks/HM-10-x 2/task.md", "Two.\n"],
      ["HM-11", "HM-10", ".octodo/tasks/HM-10-x 2/HM-11-sub/task.md", "Copy.\n"],
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
      path: ".octodo/tasks/HM-1-a/task.md",
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

  it("offers no status fix while config.json does not read, and never rewrites it", async () => {
    const root = await fresh({ "HM-1-a/task.md": "---\nid: HM-1\nstatus: in-review\n---\n" });
    write(root, "config.json", '{ "name": 3, "key": "HM" }');
    expect(await diagnostics(root)).toEqual([
      one("config.json", "invalid-config", null, null),
      one("HM-1-a/task.md", "unknown-status", "status", null),
    ]);
    expect(read(root, "config.json")).toBe('{ "name": 3, "key": "HM" }');
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
      path: ".octodo/tasks/home/notes.md",
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

  it("keeps a loose markdown file without frontmatter as a note, and fix-all wraps nothing", async () => {
    const root = await fresh({
      "README.md": "# Read me\n",
      "home/list.md": "",
      "home/notes.md": "---\ntitle: Measure the hall\n---\n",
    });
    expect(await diagnostics(root)).toEqual([
      one("README.md", "note", null, null),
      one("home/notes.md", "loose-markdown", null, "wrap-as-task"),
    ]);
    const before = files(root);
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed).toEqual([]);
    expect(files(root)).toEqual(before);
    expect(read(root, "README.md")).toBe("# Read me\n");
  });

  it("offers to delete a loose file that is an exact copy of the task its id names", async () => {
    const task = "---\nid: HM-1\ntitle: A\n---\n";
    const root = await fresh({ "HM-1-a/task.md": task, "HM-1-a.md": task });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a.md", "loose-markdown", null, "remove-copy"),
    ]);
    await fixTwice(root, {
      path: ".octodo/tasks/HM-1-a.md",
      kind: "loose-markdown",
      action: "remove-copy",
    });
    expect(files(root)).toEqual(["HM-1-a/task.md", "config.json"]);
  });

  it("leaves an attachment named like a copy of task.md alone", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a/task 2.md": "Meeting notes\n",
      "HM-1-a/task 3.md": "---\ntitle: Agenda\n---\n",
    });
    expect(await diagnostics(root)).toEqual([]);
    await inWorkspace(root, (ws) => ws.fixAll);
    expect(files(root)).toEqual([
      "HM-1-a/task 2.md",
      "HM-1-a/task 3.md",
      "HM-1-a/task.md",
      "config.json",
    ]);
  });

  it("reads a sync tool's copy of task.md as an attachment and one of list.md as loose markdown", async () => {
    const root = await fresh({
      "home/list.md": "---\nname: Home\n---\n",
      "home/list 2.md": "---\nname: Home\n---\n",
      "home/HM-1-paint/task.md": "---\nid: HM-1\ntitle: Paint\n---\nTwo coats.\n",
      "home/HM-1-paint/task 2.md": "---\nid: HM-1\ntitle: Paint\n---\nThree coats.\n",
    });
    expect((await snapshot(root)).tasks.map((task) => task.path)).toEqual([
      ".octodo/tasks/home/HM-1-paint/task.md",
    ]);
    expect(await diagnostics(root)).toEqual([
      one("home/list 2.md", "loose-markdown", null, "wrap-as-task"),
    ]);
  });

  it("refuses a fix whose action is not the one a fresh read offers", async () => {
    const task = "---\nid: HM-1\ntitle: A\n---\n";
    const root = await fresh({ "HM-1-a/task.md": task, "HM-1-a.md": task });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a.md", "loose-markdown", null, "remove-copy"),
    ]);
    write(root, "HM-1-a.md", "---\nid: HM-1\ntitle: B\n---\n");
    const stale = await inWorkspace(root, (ws) =>
      ws.fixDiagnostic({
        path: ".octodo/tasks/HM-1-a.md",
        kind: "loose-markdown",
        action: "remove-copy",
      }),
    );
    expect(stale.fixed).toEqual([]);
    expect(stale.diagnostics.map(summary)).toEqual([
      one("HM-1-a.md", "loose-markdown", null, "wrap-as-task"),
    ]);
    expect(read(root, "HM-1-a.md")).toBe("---\nid: HM-1\ntitle: B\n---\n");
  });

  it("reports a task it cannot give an id, and gives it one on the next read that can", async () => {
    const root = await fresh({ "frozen/task.md": "No id yet\n" });
    chmodSync(join(root, ".octodo/tasks/frozen"), 0o555);
    try {
      expect(await diagnostics(root)).toEqual([one("frozen/task.md", "missing-id", "id", null)]);
    } finally {
      chmodSync(join(root, ".octodo/tasks/frozen"), 0o755);
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
      path: ".octodo/tasks/HM-1-a/task.md",
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
      path: ".octodo/tasks/HM-1-a/task.md",
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

  it("never reports or serves octodo's own dot files", async () => {
    const root = await fresh({
      ".owner-lock": "",
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a/.task.md.tmp": "x",
      "home/list.md": "",
      "empty/.task.md.tmp": "x",
    });
    expect(await diagnostics(root)).toEqual([one("empty", "unmarked-folder", null, null)]);
    const served = await inWorkspace(root, (ws) =>
      Effect.flip(ws.attachment("HM-1", ".task.md.tmp")),
    );
    expect(served).toMatchObject({ _tag: "InvalidRequest" });
  });

  it("reports a symlink without following it, and no fix writes through it", async () => {
    const outside = mkdtempSync(join(tmpdir(), "octodo-outside-"));
    mkdirSync(join(outside, "HM-5-away"));
    writeFileSync(join(outside, "HM-5-away/task.md"), "---\nid: HM-5\nblocked_by: [HM-9]\n---\n");
    writeFileSync(join(outside, "loose.md"), "---\ntitle: Away\n---\n");
    const root = await fresh({
      "home/list.md": "",
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
    });
    symlinkSync(outside, join(root, ".octodo/tasks/home/linked"));
    symlinkSync(join(outside, "loose.md"), join(root, ".octodo/tasks/home/notes.md"));
    symlinkSync(join(outside, "HM-5-away"), join(root, ".octodo/tasks/HM-1-a/HM-5-away"));
    expect((await snapshot(root)).tasks.map((task) => task.id)).toEqual(["HM-1"]);
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/HM-5-away", "symlink", null, null),
      one("home/linked", "symlink", null, null),
      one("home/notes.md", "symlink", null, null),
    ]);
    await inWorkspace(root, (ws) => ws.fixAll);
    expect(
      readdirSync(outside, { recursive: true, encoding: "utf8" }).toSorted((a, b) =>
        a.localeCompare(b),
      ),
    ).toEqual(["HM-5-away", "HM-5-away/task.md", "loose.md"]);
    expect(readFileSync(join(outside, "HM-5-away/task.md"), "utf8")).toBe(
      "---\nid: HM-5\nblocked_by: [HM-9]\n---\n",
    );
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
      "HM-1-b/task.md": "---\nid: HM-1\n---\n",
      "broken/task.md": "---\nid: [\n---\n",
    });
    const stale = await inWorkspace(root, (ws) =>
      ws.fixDiagnostic({
        path: ".octodo/tasks/HM-1-a/task.md",
        kind: "duplicate-id",
        action: "fresh-id",
      }),
    );
    expect(stale.fixed).toEqual([]);
    const result = await inWorkspace(root, (ws) => ws.fixAll);
    expect(result.fixed.map((diagnostic) => diagnostic.kind).toSorted()).toEqual([
      "duplicate-id",
      "unknown-status",
    ]);
    expect(result.failed).toEqual([]);
    expect(result.diagnostics.map(summary)).toEqual([
      one("broken/task.md", "invalid-frontmatter", null, null),
      one("home/notes.md", "note", null, null),
    ]);
    expect((await inWorkspace(root, (ws) => ws.fixAll)).fixed).toEqual([]);
    expect(read(root, "home/notes.md")).toBe("Loose\n");
  });
});
