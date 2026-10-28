import { NodeServices } from "@effect/platform-node";
import type { Task, TaskSummary } from "@octodo/contract";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextOccurrence, readDay, today } from "../src/anniversary/day.ts";
import { anniversary } from "../src/anniversary/engine.ts";
import { anniversaryShared } from "../src/anniversary/shared.ts";

describe("the anniversary's day", () => {
  it("reads a day the calendar has and refuses anything else", () => {
    expect(readDay("2019-06-14")).toEqual({ day: "2019-06-14" });
    expect(readDay(" 2020-02-29 ")).toEqual({ day: "2020-02-29" });
    expect(readDay("2019-02-29")).toEqual({
      error: "The date 2019-02-29 is not a day the calendar has",
    });
    const refused = ["14 June 2019", "2019-6-14", "2019-13-01", "", 20190614, null];
    expect(refused.filter((value) => !("error" in readDay(value)))).toEqual([]);
  });

  it("comes back on its month and day, today included, counting the years", () => {
    expect(nextOccurrence("2019-06-14", "2026-10-28")).toEqual({ next: "2027-06-14", years: 8 });
    expect(nextOccurrence("2019-12-01", "2026-10-28")).toEqual({ next: "2026-12-01", years: 7 });
    expect(nextOccurrence("2019-10-28", "2026-10-28"), "today").toEqual({
      next: "2026-10-28",
      years: 7,
    });
    expect(nextOccurrence("2027-05-01", "2026-10-28"), "still to come").toEqual({
      next: "2027-05-01",
      years: 0,
    });
  });

  it("puts February 29 on the 28th in a year without one", () => {
    expect(nextOccurrence("2020-02-29", "2026-10-28")).toEqual({ next: "2027-02-28", years: 7 });
    expect(nextOccurrence("2020-02-29", "2027-03-01")).toEqual({ next: "2028-02-29", years: 8 });
    expect(nextOccurrence("2000-02-29", "2100-01-01"), "1900 and 2100 have none").toEqual({
      next: "2100-02-28",
      years: 100,
    });
  });

  it("gives the command line the next occurrence as of when it prints", () => {
    const at = new Date(2026, 9, 28, 23, 30);
    expect(today(at)).toBe("2026-10-28");
    expect(anniversaryShared.label({ date: "2025-10-29" }, at)).toBe("next 2026-10-29, 1 year");
    expect(anniversaryShared.label({ date: "1961-06-14" }, at)).toBe("next 2027-06-14, 66 years");
    expect(anniversaryShared.label({ date: "2027-01-01" }, at)).toBe("first on 2027-01-01");
    expect(anniversaryShared.label({ date: null }, at)).toBe("no date");
  });
});

const registry = makeRegistry([anniversary]);

/** A workspace keyed HM in a fresh folder that enables anniversaries unless told otherwise. */
const fresh = async (enabled = true) => {
  const base = mkdtempSync(join(tmpdir(), "octodo-anniversary-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({
    home: join(base, "home"),
    watch: false,
    plugins: [anniversary],
  }).pipe(Layer.provideMerge(NodeServices.layer));
  const use = <A, E>(effect: Effect.Effect<A, E, Workspaces | NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  await use(Workspaces.use((workspaces) => workspaces.add(root, { key: "HM" })));
  const config = join(root, ".octodo", "config.json");
  if (enabled)
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), plugins: ["anniversary"] }),
    );
  const call = (name: string, input: Record<string, unknown>) =>
    use(
      Schema.decodeUnknownEffect(
        registry.operations[name]!.input as unknown as Schema.Codec<unknown>,
      )(input).pipe(
        Effect.flatMap((decoded) =>
          registry.run(name, decoded, () => Workspaces.use((workspaces) => workspaces.open(root))),
        ),
        Effect.map((value) => ({ value: value as any, error: undefined })),
        Effect.catch((error) =>
          Effect.succeed({
            value: undefined as any,
            error: `${(error as { _tag?: string })._tag}: ${error.message}`,
          }),
        ),
      ),
    );
  const file = (path: string) => readFileSync(join(root, ".octodo", path), "utf8");
  const write = (path: string, text: string) => writeFileSync(join(root, ".octodo", path), text);
  return { call, file, write };
};

describe("an anniversary in a workspace", () => {
  it("is created and changed with a day, which task.md holds as written", async () => {
    const ws = await fresh();
    const created: Task = (
      await ws.call("create_anniversary", { title: "Mum's birthday", date: " 1961-06-14 " })
    ).value;
    expect(ws.file("HM-1-mum-s-birthday/task.md")).toMatch(
      /^---\nid: HM-1\ntitle: Mum's birthday\ntype: anniversary\ndate: 1961-06-14\nstatus: todo\n/,
    );
    expect(created.kind).toEqual({ id: "anniversary", fields: { date: "1961-06-14" } });
    expect(created.due).toBeNull();

    const changed: Task = (
      await ws.call("set_anniversary_date", { id: "HM-1", date: "1961-06-15" })
    ).value;
    expect(changed.kind?.fields).toEqual({ date: "1961-06-15" });
    expect(ws.file("HM-1-mum-s-birthday/task.md")).toContain("date: 1961-06-15\n");

    expect((await ws.call("set_anniversary_date", { id: "HM-1", date: "1961-02-30" })).error).toBe(
      "InvalidRequest: The date 1961-02-30 is not a day the calendar has",
    );
    expect((await ws.call("create_anniversary", { title: "Bad", date: "June" })).error).toBe(
      'InvalidRequest: The date "June" is not a day written YYYY-MM-DD',
    );
  });

  it("refuses its operations on a plain task", async () => {
    const ws = await fresh();
    await ws.call("create_task", { title: "Plain" });
    expect((await ws.call("set_anniversary_date", { id: "HM-1", date: "2000-01-01" })).error).toBe(
      "InvalidRequest: HM-1 is not a task of the anniversary kind",
    );
  });

  it("reports a date it cannot read, and a missing one", async () => {
    const ws = await fresh();
    await ws.call("create_anniversary", { title: "Wedding", date: "2015-09-05" });
    await ws.call("create_anniversary", { title: "Dog", date: "2020-02-29" });
    ws.write(
      "HM-1-wedding/task.md",
      ws.file("HM-1-wedding/task.md").replace("date: 2015-09-05", "date: 2015-09-31"),
    );
    ws.write("HM-2-dog/task.md", ws.file("HM-2-dog/task.md").replace("date: 2020-02-29\n", ""));
    const { value } = await ws.call("list_diagnostics", {});
    expect(value.map((d: any) => [d.kind, d.path, d.field, d.message])).toEqual([
      [
        "anniversary/bad-date",
        ".octodo/HM-1-wedding/task.md",
        "date",
        "The date 2015-09-31 is not a day the calendar has. Until it is fixed the task has no next occurrence; set one with set_anniversary_date.",
      ],
      [
        "anniversary/bad-date",
        ".octodo/HM-2-dog/task.md",
        "date",
        "The task has no date. Until it is fixed the task has no next occurrence; set one with set_anniversary_date.",
      ],
    ]);
    const summaries: ReadonlyArray<TaskSummary> = (await ws.call("list_tasks", {})).value;
    expect(summaries.map((task) => task.kind?.fields)).toEqual([{ date: null }, { date: null }]);
  });

  it("reads as a plain task where the plugin is not enabled", async () => {
    const ws = await fresh(false);
    expect(
      (await ws.call("create_anniversary", { title: "Wedding", date: "2015-09-05" })).error,
    ).toMatch(/^PluginNotEnabled/);
    await ws.call("create_task", { title: "Wedding" });
    ws.write(
      "HM-1-wedding/task.md",
      ws
        .file("HM-1-wedding/task.md")
        .replace("title: Wedding\n", "title: Wedding\ntype: anniversary\ndate: 2015-09-05\n"),
    );
    const task: Task = (await ws.call("get_task", { id: "HM-1" })).value;
    expect(task.kind).toBeUndefined();
    expect(task.extra).toEqual({ date: "2015-09-05" });
  });
});
