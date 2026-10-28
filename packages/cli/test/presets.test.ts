import { NodeServices } from "@effect/platform-node";
import type { WorkspaceSnapshot } from "@octodo/contract";
import { PRESET_IDS, PRESETS } from "@octodo/contract/presets";
import { deriveKey } from "@octodo/contract/rules";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { plugins } from "@octodo/plugins";
import { Effect, Layer, Schema } from "effect";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const registry = makeRegistry(plugins);

/** Runs operations on a fresh octodo home with every plugin octodo has. */
const home = () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-presets-"));
  const layer = Workspaces.layer({ home: join(base, "home"), watch: false, plugins }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  const call = (name: string, input: Record<string, unknown>) =>
    Effect.runPromise(
      Schema.decodeUnknownEffect(
        registry.operations[name]!.input as unknown as Schema.Codec<unknown>,
      )(input).pipe(
        Effect.flatMap((decoded) =>
          registry.run(name, decoded, (workspace) =>
            Workspaces.use((workspaces) => workspaces.open(workspace!)),
          ),
        ),
        Effect.provide(layer),
      ),
    ) as Promise<any>;
  const snapshot = (root: string) =>
    Effect.runPromise(
      Workspaces.use((workspaces) => workspaces.open(root)).pipe(
        Effect.flatMap((ws) => ws.snapshot),
        Effect.provide(layer),
      ),
    ) as Promise<WorkspaceSnapshot>;
  return { base, call, snapshot };
};

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, ".octodo", "config.json"), "utf8"));

describe("presets", () => {
  it("enable only plugins octodo has", () => {
    const installed = plugins.map((plugin) => plugin.shared.id);
    const strays = PRESET_IDS.flatMap((id) =>
      PRESETS[id].plugins.filter((plugin) => !installed.includes(plugin)),
    );
    expect(strays).toEqual([]);
  });

  it("are copied into config.json when a workspace is created, the default being Project", async () => {
    const { base, call } = home();
    for (const preset of PRESET_IDS) {
      const root = join(base, preset);
      await call("add_workspace", { root, preset });
      expect(config(root), `the ${preset} preset`).toEqual({
        name: PRESETS[preset].name,
        key: deriveKey(PRESETS[preset].name),
        statuses: PRESETS[preset].statuses,
        ...(PRESETS[preset].plugins.length === 0 ? {} : { plugins: PRESETS[preset].plugins }),
      });
    }
    const plain = join(base, "plain");
    await call("add_workspace", { root: plain, key: "PL" });
    expect(config(plain).statuses).toEqual(PRESETS.project.statuses);
    expect(config(plain).plugins).toBeUndefined();
  });

  it("leave a folder that already holds a workspace as it is", async () => {
    const { base, call } = home();
    const root = join(base, "chores");
    await call("add_workspace", { root, preset: "chores" });
    const before = readFileSync(join(root, ".octodo", "config.json"), "utf8");
    await call("add_workspace", { root, preset: "project", name: "Other" });
    expect(readFileSync(join(root, ".octodo", "config.json"), "utf8")).toBe(before);
  });
});

describe("enabling and disabling a plugin", () => {
  it("turns its tasks into plain tasks and back, writing only config.json's plugins", async () => {
    const { base, call, snapshot } = home();
    const root = join(base, "chores");
    await call("add_workspace", { root, preset: "chores" });
    await call("create_recurring", { workspace: root, title: "Water", repeat: "every 3 days" });
    expect((await snapshot(root)).tasks[0]!.kind?.id).toBe("recurring");

    expect(await call("disable_plugin", { workspace: root, plugin: "recurring" })).toEqual([]);
    expect(config(root).plugins).toEqual([]);
    const disabled = await snapshot(root);
    expect(disabled.tasks[0]!.kind).toBeUndefined();
    expect(disabled.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["unknown-kind"]);
    await expect(
      call("create_recurring", { workspace: root, title: "Sweep", repeat: "weekly" }),
    ).rejects.toMatchObject({ _tag: "PluginNotEnabled" });

    expect(await call("enable_plugin", { workspace: root, plugin: "recurring" })).toEqual([
      "recurring",
    ]);
    expect(await call("enable_plugin", { workspace: root, plugin: "recurring" })).toEqual([
      "recurring",
    ]);
    expect(config(root).plugins).toEqual(["recurring"]);
    const enabled = await snapshot(root);
    expect(enabled.tasks[0]!.kind?.id).toBe("recurring");
    expect(enabled.diagnostics).toEqual([]);
  });

  it("refuses to enable a plugin octodo does not have, and removes a stale one", async () => {
    const { base, call } = home();
    const root = join(base, "house");
    await call("add_workspace", { root, preset: "checklist" });
    await expect(
      call("enable_plugin", { workspace: root, plugin: "juggling" }),
    ).rejects.toMatchObject({ _tag: "InvalidRequest" });
    expect(config(root).plugins).toBeUndefined();
    const file = join(root, ".octodo", "config.json");
    writeFileSync(file, JSON.stringify({ ...config(root), plugins: ["juggling"] }));
    expect(await call("disable_plugin", { workspace: root, plugin: "juggling" })).toEqual([]);
    expect(config(root).plugins).toEqual([]);
    await expect(
      call("disable_plugin", { workspace: root, plugin: "juggling" }),
    ).rejects.toMatchObject({ _tag: "InvalidRequest" });
  });
});
