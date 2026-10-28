import { NodeServices } from "@effect/platform-node";
import type { WorkspaceSnapshot } from "@octodo/contract";
import { definePlugin, makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { notes } from "./notes/engine.ts";
import { notesShared } from "./notes/shared.ts";
import { tally } from "./tally/engine.ts";

const registry = makeRegistry([notes]);

/** A workspace keyed HM in a fresh folder, with an octodo home that has the notes plugin. */
const fresh = async () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-sections-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({ home: join(base, "home"), watch: false, plugins: [notes] }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  const use = <A, E>(effect: Effect.Effect<A, E, Workspaces | NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  await use(Workspaces.use((workspaces) => workspaces.add(root, { key: "HM" })));
  const config = join(root, ".octodo", "config.json");
  const enable = (...ids: Array<string>) =>
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), plugins: ids }),
    );
  const call = (name: string, input: Record<string, unknown>) =>
    use(
      Schema.decodeUnknownEffect(
        registry.operations[name]!.input as unknown as Schema.Codec<unknown>,
      )(input).pipe(
        Effect.flatMap((decoded) =>
          registry.run(name, decoded, () => Workspaces.use((workspaces) => workspaces.open(root))),
        ),
      ),
    ) as Promise<any>;
  const snapshot = (): Promise<WorkspaceSnapshot> =>
    use(Workspaces.use((workspaces) => Effect.flatMap(workspaces.open(root), (ws) => ws.snapshot)));
  /** Reads or writes a file under `.octodo/`. */
  const file = (path: string, content?: string) => {
    const at = join(root, ".octodo", path);
    if (content === undefined) return readFileSync(at, "utf8");
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, content);
    return content;
  };
  return { root, enable, call, snapshot, file };
};

const found = (snapshot: WorkspaceSnapshot) =>
  snapshot.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.path]);

describe("a plugin's section", () => {
  it("creates its entries in .octodo/<section>/ and reads them back with their fields", async () => {
    const ws = await fresh();
    ws.enable("notes");
    const created = await ws.call("create_note", { title: "Paint colours", pinned: true });
    expect(created).toMatchObject({
      id: "HM-1",
      section: "notes",
      title: "Paint colours",
      path: ".octodo/notes/HM-1-paint-colours/note.md",
      fields: { pinned: true, views: 0 },
      mentionedIn: [],
    });
    expect(ws.file("notes/HM-1-paint-colours/note.md")).toBe(
      `---\nid: HM-1\ntitle: Paint colours\npinned: true\ncreated: ${created.created}\norder: ${created.order}\n---\n`,
    );
    ws.file("notes/HM-1-paint-colours/views.log", "a\nb\n");
    const snapshot = await ws.snapshot();
    expect(snapshot.entries).toEqual([{ ...created, fields: { pinned: true, views: 2 } }]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("numbers tasks and entries in one sequence, and mentions reach across sections", async () => {
    const ws = await fresh();
    ws.enable("notes");
    await ws.call("create_task", { title: "Paint", body: "See [[HM-2]]" });
    await ws.call("create_note", { title: "Colours", body: "For [[HM-1]]" });
    await ws.call("create_task", { title: "Sand" });
    ws.file("tasks/HM-4-wait/task.md", "---\nid: HM-4\nblocked_by: [HM-2]\n---\n");
    const snapshot = await ws.snapshot();
    expect(snapshot.tasks.map((task) => [task.id, task.mentionedIn])).toEqual([
      ["HM-1", ["HM-2"]],
      ["HM-3", []],
      ["HM-4", []],
    ]);
    expect(snapshot.entries?.map((entry) => [entry.id, entry.mentionedIn])).toEqual([
      ["HM-2", ["HM-1"]],
    ]);
    expect(found(snapshot), "a link names only tasks").toEqual([
      ["broken-link", ".octodo/tasks/HM-4-wait/task.md"],
    ]);
  });

  it("leaves a disabled plugin's section unread and unreported, its ids still taken", async () => {
    const ws = await fresh();
    ws.enable("notes");
    await ws.call("create_note", { title: "Colours" });
    ws.file("notes/HM-7-old/note.md", "---\nid: HM-7\n---\n");
    ws.file("notes/stray.txt", "words");
    ws.enable();
    const disabled = await ws.snapshot();
    expect(disabled.entries).toBeUndefined();
    expect(disabled.diagnostics).toEqual([]);
    expect((await ws.call("create_task", { title: "Paint" })).id).toBe("HM-8");
    await expect(ws.call("create_note", { title: "Again" })).rejects.toMatchObject({
      _tag: "PluginNotEnabled",
    });
    ws.enable("notes");
    const enabled = await ws.snapshot();
    expect(enabled.entries?.map((entry) => entry.id)).toEqual(["HM-1", "HM-7"]);
    expect(found(enabled)).toEqual([["misplaced", ".octodo/notes/stray.txt"]]);
  });

  it("reports what its folder holds that is not an entry, and its reader's problems", async () => {
    const ws = await fresh();
    ws.enable("notes");
    ws.file("notes/HM-1-a/note.md", "---\nid: HM-1\npinned: maybe\n---\n");
    ws.file("notes/HM-1-copy/note.md", "---\nid: HM-1\n---\n");
    ws.file("notes/HM-2-task/task.md", "---\nid: HM-2\n---\n");
    ws.file("notes/HM-3-new/note.md", "---\ntitle: New\n---\n");
    ws.file("contacts/HM-9-ann/contact.md", "---\nid: HM-9\n---\n");
    const snapshot = await ws.snapshot();
    expect(snapshot.entries?.map((entry) => [entry.id, entry.title])).toEqual([
      ["HM-1", "A"],
      ["HM-10", "New"],
    ]);
    expect(found(snapshot).toSorted((a, b) => a.join().localeCompare(b.join()))).toEqual([
      ["duplicate-id", ".octodo/notes/HM-1-copy/note.md"],
      ["misplaced", ".octodo/contacts"],
      ["misplaced", ".octodo/notes/HM-2-task"],
      ["notes/bad-pinned", ".octodo/notes/HM-1-a/note.md"],
    ]);
    expect(snapshot.diagnostics.every((diagnostic) => diagnostic.fix === null)).toBe(true);
    expect(readdirSync(join(ws.root, ".octodo/notes")).toSorted()).toEqual([
      "HM-1-a",
      "HM-1-copy",
      "HM-2-task",
      "HM-3-new",
    ]);
  });

  it("refuses a section that cannot be told apart from another or from tasks", () => {
    const like = (shared: Partial<typeof notesShared> & { readonly id: string }) =>
      definePlugin({ ...notesShared, operations: {}, ...shared } as typeof notesShared, {
        read: notes.read as never,
        handlers: {} as never,
      });
    expect(() => makeRegistry([like({ id: "tasks" })])).toThrow("the folder tasks");
    expect(() => makeRegistry([like({ id: "a", section: { marker: "task.md" } })])).toThrow(
      "the marker task.md",
    );
    expect(() => makeRegistry([notes, like({ id: "b" })])).toThrow("the marker note.md");
    expect(() => makeRegistry([like({ id: "c", section: { marker: "note.txt" } })])).toThrow(
      "not a markdown file name",
    );
    expect(() =>
      makeRegistry([like({ id: "d", keys: Schema.Struct({ title: Schema.String }) as never })]),
    ).toThrow("the key title of d entries");
    expect(
      () => makeRegistry([tally, like({ id: "e", keys: tally.shared.keys as never })]),
      "a section's keys are its own, apart from the keys of tasks",
    ).not.toThrow();
  });
});
