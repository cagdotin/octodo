import { NodeServices } from "@effect/platform-node";
import type { Task, TaskSummary } from "@octodo/contract";
import { makeRegistry, Workspaces } from "@octodo/engine";
import { Effect, Exit, Layer, Schema } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recurring } from "../src/recurring/engine.ts";
import { occurrenceAt, readLog, withOccurrence, withoutOccurrence } from "../src/log.ts";
import { localDay, nextDue, parseRule, type Rule } from "../src/recurring/rule.ts";
import { recurringShared } from "../src/recurring/shared.ts";

const rule = (text: string): Rule => {
  const read = parseRule(text);
  if ("error" in read) throw new Error(read.error);
  return read.rule;
};

describe("the repeat rule", () => {
  it("reads the small grammar and refuses anything else", () => {
    expect(rule("every 3 days")).toEqual({ kind: "interval", every: 3, unit: "day" });
    expect(rule("Daily")).toEqual({ kind: "interval", every: 1, unit: "day" });
    expect(rule("every  week")).toEqual({ kind: "interval", every: 1, unit: "week" });
    expect(rule("every 2 months")).toEqual({ kind: "interval", every: 2, unit: "month" });
    expect(rule("every thursday and mon")).toEqual({ kind: "weekdays", days: [1, 4] });
    expect(rule("every monday, wednesday, friday")).toEqual({ kind: "weekdays", days: [1, 3, 5] });
    expect(rule("monthly on the 1st")).toEqual({ kind: "month-day", day: 1 });
    expect(rule("every month on the 31st")).toEqual({ kind: "month-day", day: 31 });
    expect(rule("yearly on november 27")).toEqual({ kind: "year-day", month: 11, day: 27 });
    expect(rule("every year on the 29th of feb")).toEqual({ kind: "year-day", month: 2, day: 29 });
    expect(rule("yearly on the day after the fourth thursday of november")).toEqual({
      kind: "nth-weekday",
      nth: 4,
      weekday: 4,
      month: 11,
      after: 1,
    });
    expect(rule("monthly on the last friday")).toEqual({
      kind: "nth-weekday",
      nth: -1,
      weekday: 5,
      month: null,
      after: 0,
    });
    const refused = [
      "sometimes",
      "every 0 days",
      "every funday",
      "monthly on the 32nd",
      "",
      "yearly on november 31",
      "yearly on the fourth thursday",
      "monthly on the first monday of may",
      "yearly on the sixth sunday of june",
    ];
    expect(refused.filter((text) => !("error" in parseRule(text)))).toEqual([]);
  });

  it("counts an interval from the day it was last done, and is due on its first day before", () => {
    expect(nextDue(rule("every 3 days"), ["2026-10-28"], "2026-10-01")).toBe("2026-10-31");
    expect(nextDue(rule("every 3 days"), [], "2026-10-01")).toBe("2026-10-01");
    expect(nextDue(rule("every month"), ["2026-01-31"], null), "a shorter month").toBe(
      "2026-02-28",
    );
    expect(nextDue(rule("every year"), ["2028-02-29"], null)).toBe("2029-02-28");
    expect(nextDue(rule("every 2 weeks"), ["2026-12-25"], null)).toBe("2027-01-08");
    expect(nextDue(rule("every day"), [], null)).toBeNull();
  });

  it("names the first matching day after it was last done for a calendar rule", () => {
    const bins = rule("every monday and thursday");
    expect(nextDue(bins, ["2026-10-28"], null), "a Wednesday").toBe("2026-10-29");
    expect(nextDue(bins, ["2026-10-29"], null), "a Thursday").toBe("2026-11-02");
    expect(nextDue(bins, [], "2026-10-29"), "never done, started on a Thursday").toBe("2026-10-29");
    const rent = rule("monthly on the 31st");
    expect(nextDue(rent, ["2026-10-31"], null)).toBe("2026-11-30");
    expect(nextDue(rent, ["2026-11-30"], null)).toBe("2026-12-31");
    expect(nextDue(rule("monthly on the 1st"), ["2026-10-15"], null)).toBe("2026-11-01");
  });

  it("names the day of the year a yearly rule gives, Black Friday included", () => {
    const blackFriday = rule("yearly on the day after the fourth thursday of november");
    expect(nextDue(blackFriday, [], "2026-10-30"), "created in October").toBe("2026-11-27");
    expect(nextDue(blackFriday, ["2026-11-27"], "2026-10-30"), "the year after").toBe("2027-11-26");
    expect(nextDue(blackFriday, [], "2026-11-28"), "started after this year's").toBe("2027-11-26");
    const leap = rule("yearly on february 29");
    expect(nextDue(leap, [], "2026-01-10"), "a year without one").toBe("2026-02-28");
    expect(nextDue(leap, ["2027-02-28"], null)).toBe("2028-02-29");
    const payday = rule("monthly on the last friday");
    expect(nextDue(payday, [], "2026-10-31")).toBe("2026-11-27");
    expect(nextDue(payday, ["2026-11-27"], null)).toBe("2026-12-25");
    const lateMonday = rule("monthly on 2 days after the last monday");
    expect(nextDue(lateMonday, [], "2026-11-01"), "into the next month").toBe("2026-12-02");
  });

  it("moves a calendar rule past its current due when it is done early, and never back", () => {
    const bins = rule("every monday");
    const started = "2026-10-28";
    expect(nextDue(bins, [], started), "first due, from a Wednesday").toBe("2026-11-02");
    expect(nextDue(bins, ["2026-10-29"], started), "done early, on the Thursday").toBe(
      "2026-11-09",
    );
    expect(nextDue(bins, ["2026-11-02"], started), "done on the day").toBe("2026-11-09");
    expect(nextDue(bins, ["2026-11-04"], started), "done late").toBe("2026-11-09");
    expect(
      nextDue(bins, ["2026-10-29", "2026-10-30"], started),
      "done again in the period it was already done for",
    ).toBe("2026-11-09");
    expect(
      nextDue(bins, ["2026-10-29", "2026-11-03"], started),
      "then early again, for the next one",
    ).toBe("2026-11-16");
    expect(
      nextDue(bins, ["2026-10-12", "2026-10-19"], started),
      "history from before it started leaves the first due",
    ).toBe("2026-11-02");
    const rent = rule("monthly on the 1st");
    expect(nextDue(rent, ["2026-10-20"], "2026-10-05"), "paid early").toBe("2026-12-01");
    expect(nextDue(rent, ["2026-10-01"], "2026-10-05"), "paid before it started").toBe(
      "2026-11-01",
    );
  });
});

describe("a day as an occurrence", () => {
  const zone = process.env["TZ"];
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env["TZ"];
    else process.env["TZ"] = zone;
  });
  const at = (day: string) => {
    const exit = Effect.runSyncExit(occurrenceAt(day));
    return Exit.isSuccess(exit) ? exit.value : "refused";
  };

  it.each(["America/Los_Angeles", "Europe/Istanbul", "Asia/Tokyo"])(
    "takes today at any hour in %s, never later than now, and refuses tomorrow",
    (timeZone) => {
      process.env["TZ"] = timeZone;
      vi.useFakeTimers();
      for (const hour of ["00:30", "09:00", "11:59", "12:00", "15:00", "23:45"]) {
        const now = new Date(`2026-10-28T${hour}`);
        vi.setSystemTime(now);
        const minute = at("2026-10-28");
        expect(minute, `today at ${hour}`).not.toBe("refused");
        expect(new Date(minute).getTime(), `today at ${hour}`).toBeLessThanOrEqual(now.getTime());
        expect(new Date(minute).getDate(), `today at ${hour}`).toBe(28);
        expect(at("2026-10-27"), `yesterday at ${hour}`).toBe(
          new Date("2026-10-27T12:00").toISOString().replace(".000", ""),
        );
        expect(at("2026-10-29"), `tomorrow at ${hour}`).toBe("refused");
      }
    },
  );
});

describe("the log", () => {
  it("holds each minute once and keeps lines it cannot read", () => {
    const once = withOccurrence(null, "2026-10-25T09:12:00Z", "done");
    expect(once).toBe('{"at":"2026-10-25T09:12:00Z","event":"done"}\n');
    expect(withOccurrence(once, "2026-10-25T09:12:00Z", "reset")).toBe(once);
    const messy = `${once}oops\n{"at":"2026-10-20T08:00:30.5Z","event":"done"}`;
    expect(readLog(messy)).toEqual({
      occurrences: ["2026-10-20T08:00:00Z", "2026-10-25T09:12:00Z"],
      bad: [{ line: 2, reason: "is not JSON" }],
    });
    expect(withoutOccurrence(messy, "2026-10-25T09:12:00Z")).toBe(
      'oops\n{"at":"2026-10-20T08:00:30.5Z","event":"done"}',
    );
  });
});

const registry = makeRegistry([recurring]);

/** A workspace keyed HM in a fresh folder that enables recurring tasks unless told otherwise. */
const fresh = async (enabled = true) => {
  const base = mkdtempSync(join(tmpdir(), "octodo-recurring-"));
  const root = join(base, "house");
  mkdirSync(root);
  const layer = Workspaces.layer({
    home: join(base, "home"),
    watch: false,
    plugins: [recurring],
  }).pipe(Layer.provideMerge(NodeServices.layer));
  const use = <A, E>(effect: Effect.Effect<A, E, Workspaces | NodeServices.NodeServices>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  await use(Workspaces.use((workspaces) => workspaces.add(root, { key: "HM" })));
  const config = join(root, ".octodo", "config.json");
  if (enabled)
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), plugins: ["recurring"] }),
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
  const file = (path: string) => readFileSync(join(root, ".octodo/tasks", path), "utf8");
  const write = (path: string, text: string) =>
    writeFileSync(join(root, ".octodo/tasks", path), text);
  return { call, file, write };
};

const minute = () => `${new Date().toISOString().slice(0, 16)}:00Z`;

describe("a recurring task in a workspace", () => {
  it("is created with its rule and is due from the day it starts", async () => {
    const ws = await fresh();
    const created: Task = (
      await ws.call("create_recurring", { title: "Water the plants", repeat: " every 3 days " })
    ).value;
    expect(ws.file("HM-1-water-the-plants/task.md")).toMatch(
      /^---\nid: HM-1\ntitle: Water the plants\ntype: recurring\nrepeat: every 3 days\nstatus: todo\n/,
    );
    expect(created.kind).toEqual({
      id: "recurring",
      fields: {
        repeat: "every 3 days",
        start: localDay(created.created!),
        next: localDay(created.created!),
        last: null,
        count: 0,
        recent: [],
      },
    });
    expect(
      (await ws.call("create_recurring", { title: "Bad", repeat: "sometimes" })).error,
    ).toMatch(/^InvalidRequest: The repeat rule "sometimes" is not one octodo reads/);
  });

  it("starts from its start day, and refuses one that is not a day", async () => {
    const ws = await fresh();
    const wishlist: Task = (
      await ws.call("create_recurring", {
        title: "Black Friday wishlist",
        repeat: "every year",
        start: "2026-11-27",
      })
    ).value;
    expect(ws.file("HM-1-black-friday-wishlist/task.md")).toContain("start: 2026-11-27\n");
    expect(wishlist.kind?.fields).toMatchObject({ start: "2026-11-27", next: "2026-11-27" });
    const moved: Task = (
      await ws.call("set_repeat", { id: "HM-1", repeat: "every year", start: "2027-01-02" })
    ).value;
    expect(moved.kind?.fields).toMatchObject({ start: "2027-01-02", next: "2027-01-02" });
    expect(
      (await ws.call("create_recurring", { title: "Bad", repeat: "daily", start: "2026-02-30" }))
        .error,
    ).toMatch(/^InvalidRequest: The date 2026-02-30 is not a day the calendar has/);
  });

  it("logs an occurrence when it is completed, and stays open", async () => {
    const ws = await fresh();
    await ws.call("create_recurring", { title: "Water", repeat: "every 3 days" });
    await ws.call("move_task", { id: "HM-1", status: "in-progress" });
    const moved: Task = (await ws.call("move_task", { id: "HM-1", status: "done" })).value;
    const again: Task = (await ws.call("move_task", { id: "HM-1", status: "done" })).value;
    expect(moved.status, "back in the first unstarted status").toBe("todo");
    expect(ws.file("HM-1-water/log.jsonl"), "one line for a repeat in the same minute").toBe(
      `{"at":"${minute()}","event":"done"}\n`,
    );
    expect(again.kind?.fields).toMatchObject({ count: 1, last: minute() });
    expect(ws.file("HM-1-water/task.md")).toContain("status: todo\n");

    const archived: Task = (await ws.call("move_task", { id: "HM-1", status: "archived" })).value;
    expect(archived.status, "a canceled or archived status still closes it").toBe("archived");
  });

  it("logs, lists and removes occurrences by their minute", async () => {
    const ws = await fresh();
    await ws.call("create_recurring", { title: "Bins", repeat: "every monday" });
    await ws.call("log_occurrence", { id: "HM-1", at: "2026-10-19T07:30" });
    const logged: Task = (await ws.call("log_occurrence", { id: "HM-1", at: "2026-10-19T07:30" }))
      .value;
    expect(
      logged.kind?.fields,
      "history from before it started leaves its first due",
    ).toMatchObject({
      count: 1,
      next: nextDue(rule("every monday"), [], localDay(new Date().toISOString())),
    });
    expect((await ws.call("log_occurrence", { id: "HM-1", at: "2999-01-01" })).error).toBe(
      "InvalidRequest: 2999-01-01 has not happened yet",
    );
    await ws.call("log_occurrence", { id: "HM-1", at: "2026-10-12T07:30" });
    const at = new Date("2026-10-19T07:30").toISOString().replace(".000", "");
    expect((await ws.call("list_occurrences", { id: "HM-1" })).value).toEqual([
      { at },
      { at: new Date("2026-10-12T07:30").toISOString().replace(".000", "") },
    ]);
    await ws.call("remove_occurrence", { id: "HM-1", at });
    expect((await ws.call("remove_occurrence", { id: "HM-1", at })).error).toBe(
      `InvalidRequest: HM-1 has no occurrence at ${at}`,
    );
    expect((await ws.call("list_occurrences", { id: "HM-1" })).value).toHaveLength(1);
    expect(
      (await ws.call("set_repeat", { id: "HM-1", repeat: "daily" })).value.kind.fields,
    ).toEqual(expect.objectContaining({ repeat: "daily" }));
  });

  it("refuses its operations on a plain task", async () => {
    const ws = await fresh();
    await ws.call("create_task", { title: "Plain" });
    expect((await ws.call("log_occurrence", { id: "HM-1" })).error).toBe(
      "InvalidRequest: HM-1 is not a task of the recurring kind",
    );
    expect((await ws.call("list_occurrences", { id: "HM-1" })).error).toBe(
      "InvalidRequest: HM-1 is not a task of the recurring kind",
    );
  });

  it("reports a broken rule, start day and log line, and counts the rest", async () => {
    const ws = await fresh();
    await ws.call("create_recurring", { title: "Water", repeat: "every day" });
    await ws.call("log_occurrence", { id: "HM-1", at: "2026-10-20" });
    ws.write(
      "HM-1-water/task.md",
      ws.file("HM-1-water/task.md").replace("repeat: every day", "repeat: whenever\nstart: soon"),
    );
    ws.write("HM-1-water/log.jsonl", `${ws.file("HM-1-water/log.jsonl")}{"at":"soon"}\n`);
    const { value } = await ws.call("list_diagnostics", {});
    expect(value.map((d: any) => [d.kind, d.path, d.field])).toEqual([
      ["recurring/bad-repeat", ".octodo/tasks/HM-1-water/task.md", "repeat"],
      ["recurring/bad-start", ".octodo/tasks/HM-1-water/task.md", "start"],
      ["recurring/bad-line", ".octodo/tasks/HM-1-water/log.jsonl", null],
    ]);
    expect(value[2].message).toBe(
      "Line 2 has no event. That line does not count as an occurrence.",
    );
    const summary: TaskSummary = (await ws.call("list_tasks", {})).value[0];
    expect(summary.kind?.fields).toMatchObject({ repeat: "whenever", next: null, count: 1 });
  });

  it("closes like a plain task where the plugin is not enabled", async () => {
    const ws = await fresh(false);
    expect((await ws.call("create_recurring", { title: "Water", repeat: "daily" })).error).toMatch(
      /^PluginNotEnabled/,
    );
    await ws.call("create_task", { title: "Water" });
    ws.write(
      "HM-1-water/task.md",
      ws
        .file("HM-1-water/task.md")
        .replace("title: Water\n", "title: Water\ntype: recurring\nrepeat: daily\n"),
    );
    const moved: Task = (await ws.call("move_task", { id: "HM-1", status: "done" })).value;
    expect(moved.status).toBe("done");
    expect(moved.kind).toBeUndefined();
    expect(moved.extra).toEqual({ repeat: "daily" });
  });

  it("gives the command line a label from its fields", () => {
    expect(
      recurringShared.label({
        repeat: "every 3 days",
        start: "2026-10-28",
        next: "2026-10-31",
        last: null,
        count: 0,
        recent: [],
      }),
    ).toBe("every 3 days, next 2026-10-31");
  });
});
