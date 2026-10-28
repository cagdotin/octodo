import { NodeServices } from "@effect/platform-node";
import type { WorkspaceSnapshot } from "@octodo/contract";
import { localDay } from "@octodo/contract/rules";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Layer, Schema } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { countOf, nextOccurrence } from "../src/counters/count.ts";
import { plugins } from "../src/index.ts";

const registry = makeRegistry(plugins);

/** A Chores workspace keyed HM in a fresh folder: recurring and counters enabled. */
const fresh = async () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-counters-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({ home: join(base, "home"), watch: false, plugins }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  const use = <A, E>(effect: Effect.Effect<A, E, Workspaces | NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  await use(Workspaces.use((workspaces) => workspaces.add(root, { key: "HM", preset: "chores" })));
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
  const exists = (path: string) => existsSync(join(root, ".octodo", path));
  return { call, snapshot, file, exists };
};

const today = localDay();

/** A local time as the log writes it: UTC, to the minute. */
const minute = (local: string) => `${new Date(local).toISOString().slice(0, 16)}:00Z`;
const first = minute("2026-10-16T10:00");
const second = minute("2026-10-20T08:30");

describe("a yearly counter's next occurrence", () => {
  it("is the first day from today on with its month and day, and the years it marks then", () => {
    expect(nextOccurrence("2019-06-14", "2026-10-28")).toEqual({ next: "2027-06-14", years: 8 });
    expect(nextOccurrence("2019-10-28", "2026-10-28"), "today").toEqual({
      next: "2026-10-28",
      years: 7,
    });
    expect(nextOccurrence("2027-05-01", "2026-10-28"), "still to come").toEqual({
      next: "2027-05-01",
      years: 0,
    });
    expect(nextOccurrence("2020-02-29", "2026-10-28")).toEqual({ next: "2027-02-28", years: 7 });
    expect(nextOccurrence("2020-02-29", "2027-03-01")).toEqual({ next: "2028-02-29", years: 8 });
  });

  it("counts the days until it, and a since counter the calendar days since its start", () => {
    const yearly = { type: "yearly", since: null, last: null, date: "1961-06-14" } as const;
    expect(countOf(yearly, "2026-06-10")).toEqual({ next: "2026-06-14", daysUntil: 4, years: 65 });
    const since = { type: "since", since: "2026-10-16T12:00:00Z", last: null, date: null } as const;
    expect(countOf(since, "2026-10-28")).toEqual({ daysSince: 12 });
    expect(countOf({ ...since, type: null }, "2026-10-28"), "no type").toBeNull();
  });
});

describe("counters", () => {
  it("creates a since counter in .octodo/counters/, resets it, and takes a reset back", async () => {
    const ws = await fresh();
    const created = await ws.call("create_counter", { title: "Days since coffee", type: "since" });
    expect(created).toMatchObject({
      id: "HM-1",
      section: "counters",
      path: ".octodo/counters/HM-1-days-since-coffee/counter.md",
      fields: { type: "since", since: created.created, last: null, date: null },
      count: { daysSince: 0 },
    });
    expect(ws.file("counters/HM-1-days-since-coffee/counter.md")).toBe(
      `---\nid: HM-1\ntitle: Days since coffee\ntype: since\ncreated: ${created.created}\norder: ${created.order}\n---\n`,
    );

    const reset = await ws.call("reset_counter", { id: "HM-1", at: "2026-10-16T10:00" });
    expect(reset.fields).toMatchObject({
      since: first,
      last: first,
    });
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-20T08:30" });
    await ws.call("reset_counter", { id: "HM-1", at: "2026-10-20T08:30" });
    expect(ws.file("counters/HM-1-days-since-coffee/log.jsonl"), "one line per minute").toBe(
      `{"at":"${first}","event":"reset"}\n{"at":"${second}","event":"reset"}\n`,
    );
    expect(await ws.call("list_resets", { id: "HM-1" })).toEqual([{ at: second }, { at: first }]);
    const undone = await ws.call("remove_reset", { id: "HM-1", at: second });
    expect(undone.fields.last).toBe(first);
    await expect(ws.call("remove_reset", { id: "HM-1", at: second })).rejects.toMatchObject({
      _tag: "InvalidRequest",
    });
    await expect(
      ws.call("reset_counter", { id: "HM-1", at: "2999-01-01" }),
      "a time to come",
    ).rejects.toMatchObject({ _tag: "InvalidRequest" });
    expect((await ws.snapshot()).tasks, "a counter is not a task").toEqual([]);
  });

  it("creates a yearly counter with its first day, changes it, and never resets it", async () => {
    const ws = await fresh();
    const created = await ws.call("create_counter", {
      title: "Mum's birthday",
      type: "yearly",
      date: "1961-06-14",
    });
    const { next, years } = nextOccurrence("1961-06-14", today);
    expect(created).toMatchObject({
      id: "HM-1",
      fields: { type: "yearly", since: null, last: null, date: "1961-06-14" },
      count: { next, years },
    });
    expect(ws.file("counters/HM-1-mum-s-birthday/counter.md")).toContain(
      "type: yearly\ndate: 1961-06-14\n",
    );
    await expect(ws.call("reset_counter", { id: "HM-1" })).rejects.toMatchObject({
      _tag: "InvalidRequest",
      message: "HM-1 is not a since counter, so it does not reset",
    });
    await expect(
      ws.call("create_counter", { title: "Wedding", type: "yearly" }),
    ).rejects.toMatchObject({ _tag: "InvalidRequest" });
    await expect(
      ws.call("create_counter", { title: "Coffee", type: "since", date: "2026-01-01" }),
    ).rejects.toMatchObject({ _tag: "InvalidRequest" });
    await expect(
      ws.call("update_counter", { id: "HM-1", date: "1961-02-30" }),
    ).rejects.toMatchObject({ message: "The date 1961-02-30 is not a day the calendar has" });

    const updated = await ws.call("update_counter", {
      id: "HM-1",
      title: "Mum",
      body: "Flowers, not chocolate.\n",
      date: "1961-06-15",
    });
    expect(updated).toMatchObject({
      title: "Mum",
      body: "Flowers, not chocolate.\n",
      path: ".octodo/counters/HM-1-mum/counter.md",
      fields: { date: "1961-06-15" },
    });
    expect(ws.exists("counters/HM-1-mum-s-birthday"), "the folder is renamed").toBe(false);
    expect(ws.file("counters/HM-1-mum/counter.md")).toBe(
      `---\nid: HM-1\ntitle: Mum\ntype: yearly\ndate: 1961-06-15\ncreated: ${created.created}\norder: ${created.order}\n---\n\nFlowers, not chocolate.\n`,
    );
  });

  it("lists the counters, which a task's body can mention, and refuses an id of another section", async () => {
    const ws = await fresh();
    await ws.call("create_counter", { title: "Coffee", type: "since" });
    await ws.call("create_counter", { title: "Mum", type: "yearly", date: "1961-06-14" });
    const task = await ws.call("create_task", { title: "Call", body: "Before [[HM-2]]." });
    const listed = await ws.call("list_counters", {});
    expect(listed.map((counter: any) => [counter.id, counter.title, counter.mentionedIn])).toEqual([
      ["HM-1", "Coffee", []],
      ["HM-2", "Mum", [task.id]],
    ]);
    await expect(ws.call("update_counter", { id: task.id, title: "x" })).rejects.toMatchObject({
      _tag: "EntryNotFound",
      message: `No entry in counters with id ${task.id}`,
    });
  });

  it("deletes a counter, its folder and every task's link to it", async () => {
    const ws = await fresh();
    await ws.call("create_counter", { title: "Coffee", type: "since" });
    await ws.call("reset_counter", { id: "HM-1" });
    await ws.call("create_task", { title: "Call" });
    ws.file("tasks/HM-2-call/task.md", "---\nid: HM-2\ntitle: Call\nblocked_by: [HM-1]\n---\n");
    expect(await ws.call("delete_counter", { id: "HM-1" })).toEqual({ deleted: "HM-1" });
    expect(ws.exists("counters/HM-1-coffee")).toBe(false);
    expect(ws.file("tasks/HM-2-call/task.md")).toBe("---\nid: HM-2\ntitle: Call\n---\n");
    expect(await ws.call("list_counters", {})).toEqual([]);
    await expect(ws.call("delete_counter", { id: "HM-1" })).rejects.toMatchObject({
      _tag: "EntryNotFound",
    });
  });

  it("reports a type or a date it cannot read, and counts nothing for it", async () => {
    const ws = await fresh();
    ws.file("counters/HM-1-x/counter.md", "---\nid: HM-1\ntitle: X\ntype: weekly\n---\n");
    ws.file("counters/HM-2-y/counter.md", "---\nid: HM-2\ntitle: Y\ntype: yearly\n---\n");
    const snapshot = await ws.snapshot();
    expect(snapshot.diagnostics.map((d) => [d.kind, d.path, d.field])).toEqual([
      ["counters/bad-type", ".octodo/counters/HM-1-x/counter.md", "type"],
      ["counters/bad-date", ".octodo/counters/HM-2-y/counter.md", "date"],
    ]);
    expect((await ws.call("list_counters", {})).map((counter: any) => counter.count)).toEqual([
      null,
      null,
    ]);
  });
});
