import { NodeServices } from "@effect/platform-node";
import type { Task, TaskSummary } from "@octodo/contract";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { counterShared, type CounterFields } from "../src/counter/shared.ts";
import { counted, daysBetween } from "../src/counter/days.ts";
import { plugins } from "../src/index.ts";
import { readLog } from "../src/log.ts";

const registry = makeRegistry(plugins);

/** A workspace keyed HM in a fresh folder that enables `enabled`. */
const fresh = async (enabled: ReadonlyArray<string> = ["counter"]) => {
  const base = mkdtempSync(join(tmpdir(), "octodo-counter-"));
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
    JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), plugins: enabled }),
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

const utc = (local: string) => new Date(local).toISOString().replace(".000", "");

describe("the days a counter shows", () => {
  it("counts calendar days, and the best run includes the current one", () => {
    expect(daysBetween("2026-10-16T23:59", new Date("2026-10-17T00:01"))).toBe(1);
    expect(daysBetween("2026-10-17T00:01", new Date("2026-10-17T23:59"))).toBe(0);
    expect(daysBetween("soon")).toBeNull();
    const fields: CounterFields = {
      since: utc("2026-10-16T12:00"),
      last: null,
      resets: 0,
      longest: 5,
      recent: [],
    };
    expect(counted(fields, new Date("2026-10-28T08:00"))).toEqual({ current: 12, best: 12 });
    expect(counted({ ...fields, longest: 30 }, new Date("2026-10-28T08:00")).best).toBe(30);
  });

  it("reads a recurring task's done lines as resets, so switching type keeps the history", () => {
    expect(
      readLog(
        '{"at":"2026-10-20T08:00:00Z","event":"done"}\n{"at":"2026-10-25T08:00:00Z","event":"reset"}\n{"at":"2026-10-26T08:00:00Z","event":"oops"}\n',
      ),
    ).toEqual({
      occurrences: ["2026-10-20T08:00:00Z", "2026-10-25T08:00:00Z"],
      bad: [{ line: 3, reason: 'has the event "oops", not one of "done" or "reset"' }],
    });
  });
});

describe("a counter in a workspace", () => {
  it("is created counting from now, with no keys of its own", async () => {
    const ws = await fresh();
    const created: Task = (await ws.call("create_counter", { title: "Since I last smoked" })).value;
    expect(ws.file("HM-1-since-i-last-smoked/task.md")).toMatch(
      /^---\nid: HM-1\ntitle: Since I last smoked\ntype: counter\nstatus: todo\n/,
    );
    expect(created.kind).toEqual({
      id: "counter",
      fields: { since: created.created, last: null, resets: 0, longest: 0, recent: [] },
    });
  });

  it("resets now or at an earlier time, once a minute, and takes a reset back", async () => {
    const ws = await fresh();
    await ws.call("create_counter", { title: "Smoked" });
    const early = utc("2026-09-01T09:00");
    const mid = utc("2026-10-01T09:00");
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-01T09:00" });
    const reset: Task = (await ws.call("reset_counter", { id: "HM-1", at: "2026-09-01T09:00" }))
      .value;
    expect(reset.kind?.fields, "a reset before the counter was made starts it").toEqual({
      since: mid,
      last: mid,
      resets: 2,
      longest: 30,
      recent: [mid, early],
    });
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-01T09:00" });
    expect(ws.file("HM-1-smoked/log.jsonl")).toBe(
      `{"at":"${mid}","event":"reset"}\n{"at":"${early}","event":"reset"}\n`,
    );
    expect((await ws.call("reset_counter", { id: "HM-1", at: "2999-01-01" })).error).toBe(
      "InvalidRequest: 2999-01-01 has not happened yet",
    );

    const now: Task = (await ws.call("reset_counter", { id: "HM-1" })).value;
    expect(now.kind?.fields["resets"]).toBe(3);
    expect(counted(now.kind!.fields as CounterFields).current).toBe(0);
    expect((await ws.call("list_resets", { id: "HM-1" })).value.slice(1)).toEqual([
      { at: mid },
      { at: early },
    ]);

    await ws.call("remove_reset", { id: "HM-1", at: mid });
    expect((await ws.call("remove_reset", { id: "HM-1", at: mid })).error).toBe(
      `InvalidRequest: HM-1 has no reset at ${mid}`,
    );
    expect(ws.file("HM-1-smoked/log.jsonl")).not.toContain(mid);
  });

  it("closes like a plain task when it is completed", async () => {
    const ws = await fresh();
    await ws.call("create_counter", { title: "Smoked" });
    const moved: Task = (await ws.call("move_task", { id: "HM-1", status: "done" })).value;
    expect(moved.status).toBe("done");
    expect(moved.kind?.fields["resets"], "completing is not a reset").toBe(0);
  });

  it("reports a broken log line and counts the rest", async () => {
    const ws = await fresh();
    await ws.call("create_counter", { title: "Smoked" });
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-20" });
    ws.write("HM-1-smoked/log.jsonl", `${ws.file("HM-1-smoked/log.jsonl")}{"at":"soon"}\n`);
    const { value } = await ws.call("list_diagnostics", {});
    expect(value.map((d: any) => [d.kind, d.path, d.message])).toEqual([
      [
        "counter/bad-line",
        ".octodo/HM-1-smoked/log.jsonl",
        "Line 2 has no event. That line does not count as a reset.",
      ],
    ]);
    const summary: TaskSummary = (await ws.call("list_tasks", {})).value[0];
    expect(summary.kind?.fields).toMatchObject({ resets: 1 });
  });

  it("keeps its history when its type becomes recurring, and back", async () => {
    const ws = await fresh(["counter", "recurring"]);
    await ws.call("create_counter", { title: "Water" });
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-20" });
    const task = ws.file("HM-1-water/task.md");
    ws.write(
      "HM-1-water/task.md",
      task.replace("type: counter\n", "type: recurring\nrepeat: every 3 days\n"),
    );
    const recurring: Task = (await ws.call("get_task", { id: "HM-1" })).value;
    expect(recurring.kind?.fields).toMatchObject({ count: 1, next: "2026-10-23" });
    expect((await ws.call("get_task", { id: "HM-1" })).value.attachments).toEqual([]);
    ws.write("HM-1-water/task.md", task);
    expect((await ws.call("get_task", { id: "HM-1" })).value.kind.fields.resets).toBe(1);
  });

  it("reads as a plain task where the plugin is not enabled, its log an attachment", async () => {
    const ws = await fresh([]);
    expect((await ws.call("create_counter", { title: "Smoked" })).error).toMatch(
      /^PluginNotEnabled/,
    );
    await ws.call("create_task", { title: "Smoked" });
    const task = ws.file("HM-1-smoked/task.md");
    ws.write(
      "HM-1-smoked/task.md",
      task.replace("title: Smoked\n", "title: Smoked\ntype: counter\n"),
    );
    ws.write("HM-1-smoked/log.jsonl", '{"at":"2026-10-20T08:00:00Z","event":"reset"}\n');
    const plain = (await ws.call("get_task", { id: "HM-1" })).value;
    expect(plain.kind).toBeUndefined();
    expect(plain.attachments.map((a: { path: string }) => a.path)).toEqual(["log.jsonl"]);
  });

  it("gives the command line a label from its fields", () => {
    const today = new Date();
    expect(
      counterShared.label({
        since: today.toISOString(),
        last: null,
        resets: 0,
        longest: 4,
        recent: [],
      }),
    ).toMatch(/^0 days since \d{4}-\d\d-\d\d, best 4 days$/);
    expect(
      counterShared.label({ since: null, last: null, resets: 0, longest: 0, recent: [] }),
    ).toBe("not started");
  });
});
