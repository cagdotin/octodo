import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagnostic, DiagnosticKind, FixAction, FixRequest } from "../src/domain.ts";
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

/** Every file under `.octodo/`, relative to it and sorted. */
const files = (root: string) =>
  readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" })
    .filter((entry) => statSync(join(root, ".octodo", entry)).isFile())
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
    const result = await fixTwice(root, { path: ".octodo/HM-1-a/task.md", kind: "invalid-due" });
    expect(result.fixed).toEqual([]);
    expect(read(root, "HM-1-a/task.md")).toBe(before);
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

  it("gives a copied task folder a new id and renames it, then its copied subtasks", async () => {
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
    });
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-paint-copy/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
    expect(read(root, "HM-3-paint-copy/task.md")).toBe("---\nid: HM-3\ntitle: Paint\n---\n");
    expect(result.diagnostics.map(summary)).toEqual([
      one("HM-3-paint-copy/HM-2-primer/task.md", "duplicate-id", "id", "fresh-id"),
    ]);
    const all = await inWorkspace(root, (ws) => ws.fixAll);
    expect(all.diagnostics).toEqual([]);
    expect((await snapshot(root)).tasks.map((task) => [task.id, task.parent])).toEqual([
      ["HM-1", null],
      ["HM-2", "HM-1"],
      ["HM-3", null],
      ["HM-4", "HM-3"],
    ]);
  });

  it("adds an unknown status to config.json as unstarted only when asked", async () => {
    const root = await fresh({ "HM-1-a/task.md": "---\nid: HM-1\nstatus: in-review\n---\n" });
    const config = read(root, "config.json");
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "unknown-status", "status", "add-status"),
    ]);
    expect(read(root, "config.json"), "reading never adds it").toBe(config);
    await fixTwice(root, { path: ".octodo/HM-1-a/task.md", kind: "unknown-status" });
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
    await fixTwice(root, { path: ".octodo/home/notes.md", kind: "loose-markdown" });
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
    await fixTwice(root, { path: ".octodo/HM-1-a.md", kind: "loose-markdown" });
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
    await fixTwice(root, { path: ".octodo/home/HM-1-paint/task 2.md", kind: "conflict-copy" });
    await fixTwice(root, { path: ".octodo/HM-2-b/task 3.md", kind: "conflict-copy" });
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
    await fixTwice(root, { path: ".octodo/HM-1-paint 2", kind: "conflict-copy" });
    await fixTwice(root, { path: ".octodo/HM-2-tile 2", kind: "conflict-copy" });
    expect(files(root)).toEqual([
      "HM-1-paint/images/plan.png",
      "HM-1-paint/task.md",
      "HM-2-tile/task.md",
      "HM-3-tile/task.md",
      "config.json",
    ]);
    expect(read(root, "HM-3-tile/task.md")).toBe("---\nid: HM-3\n---\n\nWhite.\n");
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
    await fixTwice(root, { path: ".octodo/home/list 2.md", kind: "conflict-copy" });
    await fixTwice(root, { path: ".octodo/garden/list 2.md", kind: "conflict-copy" });
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
    await fixTwice(root, { path: ".octodo", kind: "old-layout" });
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
    const result = await fixTwice(root, { path: ".octodo/HM-1-a/task.md", kind: "broken-link" });
    expect(result.fixed.map(summary)).toEqual([
      one("HM-1-a/task.md", "broken-link", "blocked_by", "drop-unknown-links"),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(read(root, "HM-1-a/task.md")).toBe(
      "---\nid: HM-1\nblocked_by: [HM-2]\nnote: kept\n---\n",
    );
  });

  it("drops a task's link to itself, and the next run finds nothing to do", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\nblocked_by: [HM-1]\n---\nBody\n",
    });
    expect((await snapshot(root)).tasks[0]).toMatchObject({ blockedBy: [], blocked: false });
    expect(await diagnostics(root)).toEqual([
      one("HM-1-a/task.md", "self-link", "blocked_by", "drop-self-link"),
    ]);
    const result = await fixTwice(root, { path: ".octodo/HM-1-a/task.md", kind: "self-link" });
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

  it("removes a pending-id marker a crash left beside a task that has its id", async () => {
    const root = await fresh({
      "HM-1-a/task.md": "---\nid: HM-1\n---\n",
      "HM-1-a/.pending-id": "HM-1\n",
      "HM-2-b/task.md": "---\nid: HM-2\n---\n",
      "HM-2-b/.pending-id": "HM-2\n",
    });
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    utimesSync(join(root, ".octodo/HM-1-a/.pending-id"), twoMinutesAgo, twoMinutesAgo);
    expect(await diagnostics(root)).toEqual([]);
    expect(existsSync(join(root, ".octodo/HM-1-a/.pending-id"))).toBe(false);
    expect(existsSync(join(root, ".octodo/HM-2-b/.pending-id")), "a fresh marker stays").toBe(true);
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
      ws.fixDiagnostic({ path: ".octodo/HM-1-a/task.md", kind: "duplicate-id" }),
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
