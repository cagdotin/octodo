import { NodeServices } from "@effect/platform-node";
import { localDay } from "@octodo/contract/rules";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plugins } from "../src/index.ts";
import { webPlugins } from "../src/web.ts";

const registry = makeRegistry(plugins);

/** A Chores workspace keyed HM in a fresh folder, every plugin enabled. */
const fresh = async () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-due-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({ home: join(base, "home"), watch: false, plugins }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  const use = <A, E>(effect: Effect.Effect<A, E, Workspaces | NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  await use(Workspaces.use((workspaces) => workspaces.add(root, { key: "HM" })));
  const config = join(root, ".octodo", "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      ...JSON.parse(readFileSync(config, "utf8")),
      plugins: plugins.map((plugin) => plugin.shared.id),
    }),
  );
  return (name: string, input: Record<string, unknown>) =>
    use(
      Schema.decodeUnknownEffect(
        registry.operations[name]!.input as unknown as Schema.Codec<unknown>,
      )(input).pipe(
        Effect.flatMap((decoded) =>
          registry.run(name, decoded, () => Workspaces.use((workspaces) => workspaces.open(root))),
        ),
      ),
    ) as Promise<any>;
};

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDay(date);
};

describe("a task's due day", () => {
  it("is one function per kind, the same in the engine and the app", () => {
    expect(plugins.map(({ shared }) => [shared.id, webPlugins[shared.id]?.day])).toEqual(
      plugins.map(({ shared }) => [shared.id, shared.day]),
    );
  });

  it("lists tasks due by a day the way Today does: kinds by their own day, overdue included", async () => {
    const call = await fresh();
    const id = async (name: string, input: Record<string, unknown>) =>
      ((await call(name, input)) as { id: string }).id;
    const plain = await id("create_task", { title: "Pay rent", due: day(0) });
    const late = await id("create_task", { title: "Return books", due: day(-2) });
    const water = await id("create_recurring", { title: "Water plants", repeat: "every 3 days" });
    const bins = await id("create_recurring", { title: "Bins", repeat: "every 2 days" });
    await call("log_occurrence", { id: bins, at: day(-5) });
    const sheets = await id("create_recurring", { title: "Sheets", repeat: "every 6 days" });
    await call("log_occurrence", { id: sheets, at: day(0) });
    const birthday = await id("create_anniversary", {
      title: "Mum",
      date: `1961-${day(0).slice(5)}`,
    });
    const wedding = await id("create_anniversary", {
      title: "Wedding",
      date: `2015-${day(5).slice(5)}`,
    });
    await id("create_counter", { title: "Days since coffee" });
    const dueBy = async (last: string) =>
      ((await call("list_tasks", { due_by: last })) as Array<{ id: string }>).map(
        (task) => task.id,
      );
    expect(await dueBy(day(0)), "today").toEqual([plain, late, water, bins, birthday]);
    expect(await dueBy(day(7)), "the next 7 days").toEqual([
      plain,
      late,
      water,
      bins,
      sheets,
      birthday,
      wedding,
    ]);
  });
});
