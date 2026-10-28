import { NodeServices } from "@effect/platform-node";
import type { Task, TaskDetail, WorkspaceSnapshot } from "@octodo/contract";
import { definePlugin, makeRegistry, plainTask, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { operationCommands } from "../../cli/src/commands.ts";
import { plugins } from "../src/index.ts";
import { tally } from "./tally/engine.ts";
import { tallyShared } from "./tally/shared.ts";

const registry = makeRegistry([tally]);

/** A workspace keyed HM in a fresh folder, with an octodo home that has the tally plugin. */
const fresh = async () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-plugins-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({ home: join(base, "home"), watch: false, plugins: [tally] }).pipe(
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
  /** Runs an operation as every surface does, giving its value or its error's tag and message. */
  const call = (name: string, input: Record<string, unknown>) =>
    use(
      Schema.decodeUnknownEffect(
        registry.operations[name]!.input as unknown as Schema.Codec<unknown>,
      )(input).pipe(
        Effect.flatMap((decoded) =>
          registry.run(name, decoded, () => Workspaces.use((workspaces) => workspaces.open(root))),
        ),
        Effect.map((value): { value?: any; error?: string } => ({ value })),
        Effect.catch((error) =>
          Effect.succeed({ error: `${(error as { _tag?: string })._tag}: ${error.message}` } as {
            value?: any;
            error?: string;
          }),
        ),
      ),
    );
  const snapshot = () =>
    use(Workspaces.use((workspaces) => Effect.flatMap(workspaces.open(root), (ws) => ws.snapshot)));
  const file = (path: string) => readFileSync(join(root, ".octodo", path), "utf8");
  return { root, use, enable, call, snapshot, file };
};

const kinds = (snapshot: WorkspaceSnapshot) => snapshot.diagnostics.map((d) => [d.kind, d.path]);

describe("the plugin registry", () => {
  it("installs the first-party plugins, and the plain task registers through it", () => {
    expect(plugins.map((plugin) => plugin.shared.id)).toEqual(["recurring"]);
    expect(Object.keys(makeRegistry([]).operations)).toEqual(Object.keys(plainTask.operations));
  });

  it("lists a plugin's operations after the plain task's, able to fail as not enabled", () => {
    const names = Object.keys(registry.operations);
    expect(names.slice(-2)).toEqual(["create_tally", "bump_tally"]);
    expect(String(registry.operations["bump_tally"]!.error.ast._tag)).toBe("Union");
  });

  it("refuses two claims on one kind, key, file or operation, loudly", () => {
    const like = (shared: Partial<typeof tallyShared>) =>
      definePlugin({ ...tallyShared, ...shared } as typeof tallyShared, {
        read: tally.read as never,
        handlers: tally.handlers as never,
      });
    expect(() => makeRegistry([tally, tally])).toThrow("the kind tally");
    expect(() => makeRegistry([like({ id: "due-keeper", keys: plainTask.keys as never })])).toThrow(
      "the key id",
    );
    expect(() =>
      makeRegistry([
        tally,
        like({ id: "other", keys: Schema.Struct({}) as never, operations: {} as never }),
      ]),
    ).toThrow("the file tally.log");
    expect(() => makeRegistry([like({ files: ["task.md"] })])).toThrow("cannot own task.md");
    expect(() =>
      makeRegistry([
        like({
          operations: { get_task: tallyShared.operations.bump_tally } as never,
        }),
      ]),
    ).toThrow("the operation get_task");
  });
});

describe("a plugin's kind in a workspace", () => {
  it("reads a task naming a kind the workspace does not enable as a plain task, and refuses its operations", async () => {
    const ws = await fresh();
    mkdirSync(join(ws.root, ".octodo", "HM-1-water"));
    writeFileSync(
      join(ws.root, ".octodo", "HM-1-water", "task.md"),
      "---\nid: HM-1\ntitle: Water\ntype: tally\nstep: 2\n---\n",
    );
    writeFileSync(join(ws.root, ".octodo", "HM-1-water", "tally.log"), "not a time\n");
    const snapshot = await ws.snapshot();
    expect(snapshot.plugins).toBeUndefined();
    expect(snapshot.tasks[0]!.kind).toBeUndefined();
    expect(snapshot.tasks[0]!.extra).toEqual({ step: 2 });
    expect(snapshot.diagnostics.map((d) => [d.kind, d.field, d.message])).toEqual([
      [
        "unknown-kind",
        "type",
        "The type tally is a plugin this workspace does not enable. It reads as a plain task until the plugin is enabled in the workspace's settings (octo plugins enable, MCP enable_plugin) or the type line is removed.",
      ],
    ]);
    expect((await ws.call("get_task", { id: "HM-1" })).value.attachments).toEqual([
      { path: "tally.log", size: 11, mediaType: "application/octet-stream" },
    ]);
    expect(await ws.call("bump_tally", { id: "HM-1" })).toEqual({
      error: `PluginNotEnabled: The tally plugin is not enabled in ${ws.root}; add "tally" to "plugins" in its .octodo/config.json`,
    });
  });

  it("creates, reads, bumps and validates a task of the kind, and keeps its file private", async () => {
    const ws = await fresh();
    ws.enable("tally", "nope");

    const created = (await ws.call("create_tally", { title: "Water", step: 2 })).value as Task;
    expect(created.kind).toEqual({ id: "tally", fields: { count: 0, last: null } });
    expect(created.extra).toEqual({});
    const folder = "HM-1-water";
    expect(ws.file(`${folder}/task.md`)).toMatch(
      /^---\nid: HM-1\ntitle: Water\ntype: tally\nstep: 2\nstatus: todo\n/,
    );

    await ws.call("bump_tally", { id: "HM-1" });
    const bumped = (await ws.call("bump_tally", { id: "HM-1" })).value as Task;
    expect(ws.file(`${folder}/tally.log`).split("\n")).toHaveLength(3);
    expect(bumped.kind?.fields["count"]).toBe(4);

    const snapshot = await ws.snapshot();
    expect(snapshot.plugins).toEqual(["tally"]);
    expect((await ws.call("get_workspace", {})).value.plugins).toEqual(["tally"]);
    expect(kinds(snapshot)).toEqual([["invalid-config", ".octodo/config.json"]]);
    expect(snapshot.diagnostics[0]!.message).toContain('The plugin "nope" is not one octodo has');

    writeFileSync(join(ws.root, ".octodo", folder, "notes.txt"), "notes");
    const detail = (await ws.call("get_task", { id: "HM-1" })).value as TaskDetail;
    expect(detail.attachments.map((attachment) => attachment.path)).toEqual(["notes.txt"]);
    expect(await ws.call("read_attachment", { id: "HM-1", path: "tally.log" })).toEqual({
      error: "AttachmentNotFound: Task HM-1 has no attachment tally.log",
    });
    expect(
      await ws.use(
        Workspaces.use((workspaces) =>
          Effect.flatMap(workspaces.open(ws.root), (opened) =>
            Effect.flip(opened.writeAttachment("HM-1", "TALLY.LOG", new Uint8Array([1]))),
          ),
        ),
      ),
    ).toMatchObject({ _tag: "InvalidRequest" });

    expect(await ws.call("update_task", { id: "HM-1", title: "Water plants" })).not.toHaveProperty(
      "error",
    );
    expect(ws.file("HM-1-water-plants/task.md")).toContain("type: tally\nstep: 2\n");

    writeFileSync(
      join(ws.root, ".octodo", "HM-1-water-plants", "task.md"),
      ws.file("HM-1-water-plants/task.md").replace("step: 2", "step: -1"),
    );
    writeFileSync(
      join(ws.root, ".octodo", "HM-1-water-plants", "tally.log"),
      `${ws.file("HM-1-water-plants/tally.log")}oops\n`,
    );
    const broken = await ws.snapshot();
    expect(broken.tasks[0]!.kind?.fields).toMatchObject({ count: 2 });
    expect(broken.diagnostics.slice(1).map((d) => [d.kind, d.path, d.field, d.fix])).toEqual([
      ["tally/bad-step", ".octodo/HM-1-water-plants/task.md", "step", null],
      ["tally/bad-line", ".octodo/HM-1-water-plants/tally.log", null, null],
    ]);
    expect(broken.diagnostics[2]!.message).toBe(
      'Line 3 is "oops", not a time. That line is not counted.',
    );
  });

  it("runs a plugin's operation as a generated command", async () => {
    const ws = await fresh();
    ws.enable("tally");
    const workspace = Workspaces.use((workspaces) => workspaces.open(ws.root));
    const octo = Command.make("octo").pipe(
      Command.withSubcommands([
        Command.make("tally").pipe(
          Command.withSubcommands(
            operationCommands(registry, (name, input) => registry.run(name, input, () => workspace))
              .filter(({ words }) => words[0] === "tally")
              .map(({ command }) => command),
          ),
        ),
      ]),
    );
    const lines = await ws.use(
      Command.runWith(octo, { version: "0" })([
        "tally",
        "create",
        "Water",
        "--step",
        "3",
        "--json",
      ]).pipe(
        Effect.andThen(TestConsole.logLines),
        Effect.provide(TestConsole.layer),
      ) as Effect.Effect<ReadonlyArray<unknown>, unknown, Workspaces | NodeServices.NodeServices>,
    );
    expect(JSON.parse(lines.join("\n")).kind).toEqual({
      id: "tally",
      fields: { count: 0, last: null },
    });
  });
});
