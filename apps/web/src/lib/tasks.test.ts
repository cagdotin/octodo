import { type Task, type WorkspaceSnapshot, DEFAULT_STATUSES } from "@octodo/contract";
import { readiness } from "@octodo/contract/rules";
import { dueInfo } from "@octodo/ui/lib/dates";
import { addDays, format } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  descendantCount,
  dueEntries,
  filterTasks,
  listCounts,
  SMART,
  subtaskProgress,
  withBlockedBy,
  withoutSubtree,
} from "./tasks.ts";
import { sectionDay } from "../components/section.tsx";
import { kindDay } from "../components/task-kind.tsx";

const TODAY = format(new Date(), "yyyy-MM-dd");

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: "todo",
  list: null,
  parent: null,
  priority: "none",
  tags: [],
  due: null,
  created: null,
  updated: null,
  order: "a0",
  body: "",
  path: `.octodo/tasks/${id}/task.md`,
  extra: {},
  blockedBy: [],
  blocks: [],
  blocked: false,
  ready: true,
  mentions: [],
  mentionedIn: [],
  ...fields,
});

/** A snapshot of `tasks` with `blocked` and `ready` derived as a read does. */
const snapshot = (tasks: Array<Task>): WorkspaceSnapshot => {
  const rules = readiness(tasks, DEFAULT_STATUSES);
  return {
    workspace: { id: "hm", name: "House", key: "HM", root: "/tmp/house" },
    statuses: DEFAULT_STATUSES,
    lists: [{ id: "home", name: "Home", parent: null, folder: "home" }],
    tasks: tasks.map((task) => ({ ...task, ...rules.of(task) })),
    diagnostics: [],
  };
};

const TASKS = [
  task("HM-1", { list: "home" }),
  task("HM-2", { list: "home", parent: "HM-1", status: "done" }),
  task("HM-3", { list: "home", parent: "HM-1" }),
  task("HM-4", { list: "home", parent: "HM-3", status: "done" }),
  task("HM-5"),
];

describe("subtasks in views", () => {
  it("shows only top-level tasks in list views, and subtasks too in date views", () => {
    const tasks = [
      ...TASKS,
      task("HM-6", { list: "home", parent: "HM-1", due: "2000-01-01" }),
      task("HM-7", { due: "2000-01-01" }),
    ];
    const ids = (list: string | undefined) =>
      filterTasks(snapshot(tasks), list, kindDay, TODAY).map((entry) => entry.id);
    expect(ids(undefined)).toEqual(["HM-1", "HM-5", "HM-7"]);
    expect(ids("home")).toEqual(["HM-1"]);
    expect(ids(SMART.none)).toEqual(["HM-5", "HM-7"]);
    expect(ids(SMART.today)).toEqual(["HM-6", "HM-7"]);
    expect(ids(SMART.upcoming)).toEqual(["HM-6", "HM-7"]);
    expect(listCounts(snapshot(tasks)).counts.get("home")).toBe(1);
  });

  it("shows open tasks that are not blocked in the Ready view, subtasks too, as the CLI and MCP do", () => {
    const tasks = snapshot([
      task("HM-1"),
      task("HM-2", { blockedBy: ["HM-1"] }),
      task("HM-3", { status: "done" }),
      task("HM-4", { parent: "HM-1" }),
      task("HM-5", { status: "in-progress" }),
      task("HM-6", { parent: "HM-1", blockedBy: ["HM-5"] }),
    ]);
    const ready = (current: WorkspaceSnapshot) =>
      filterTasks(current, SMART.ready, kindDay, TODAY).map((entry) => entry.id);
    expect(ready(tasks)).toEqual(["HM-1", "HM-4", "HM-5"]);
    expect(ready(applyMove(tasks, "HM-1", { status: "done" })), "a finished blocker").toEqual([
      "HM-2",
      "HM-4",
      "HM-5",
    ]);
  });

  it("counts direct subtasks in a completed status as done, and leaves canceled ones out", () => {
    const progress = subtaskProgress({
      ...snapshot([
        ...TASKS,
        task("HM-6", { parent: "HM-1", status: "canceled" }),
        task("HM-7", { parent: "HM-5", status: "canceled" }),
      ]),
      statuses: [...DEFAULT_STATUSES, { id: "canceled", name: "Canceled", category: "canceled" }],
    });
    expect(progress.get("HM-1")).toEqual({ done: 1, total: 2 });
    expect(progress.get("HM-3")).toEqual({ done: 1, total: 1 });
    expect(progress.has("HM-5")).toBe(false);
  });

  it("deletes a task together with its subtasks at any depth", () => {
    expect(descendantCount(TASKS, "HM-1")).toBe(3);
    expect(withoutSubtree(TASKS, "HM-1").map((entry) => entry.id)).toEqual(["HM-5"]);
  });

  it("moves a task under a parent into the parent's list, and lifts it out again", () => {
    const under = applyMove(snapshot(TASKS), "HM-5", { parent: "HM-1" });
    expect(under.tasks.find((entry) => entry.id === "HM-5")).toMatchObject({
      parent: "HM-1",
      list: "home",
    });
    const lifted = applyMove(under, "HM-5", { parent: null });
    expect(lifted.tasks.find((entry) => entry.id === "HM-5")).toMatchObject({
      parent: null,
      list: "home",
    });
    const status = applyMove(snapshot(TASKS), "HM-3", { status: "done" });
    expect(status.tasks.find((entry) => entry.id === "HM-3")).toMatchObject({
      parent: "HM-1",
      status: "done",
    });
  });

  it("keeps a task that completes in place open, as the engine does", () => {
    const inPlace = (entry: Task) => entry.id === "HM-3";
    const moved = applyMove(snapshot(TASKS), "HM-3", { status: "done" }, inPlace);
    expect(moved.tasks.find((entry) => entry.id === "HM-3")?.status).toBe("todo");
    const archived = applyMove(snapshot(TASKS), "HM-3", { status: "archived" }, inPlace);
    expect(archived.tasks.find((entry) => entry.id === "HM-3")?.status).toBe("archived");
  });

  it("leaves the snapshot as it is for a move the server refuses", () => {
    const before = snapshot(TASKS);
    expect(applyMove(before, "HM-5", { list: "nowhere" })).toBe(before);
    expect(applyMove(before, "HM-5", { parent: "HM-9" })).toBe(before);
  });

  it("keeps a task's place on a status-only move, as core keeps its order", () => {
    const ids = (moved: WorkspaceSnapshot) => moved.tasks.map((entry) => entry.id);
    const order = TASKS.map((entry) => entry.id);
    expect(ids(applyMove(snapshot(TASKS), "HM-2", { status: "todo" }))).toEqual(order);
    expect(ids(applyMove(snapshot(TASKS), "HM-2", { status: "todo", parent: "HM-1" }))).toEqual(
      order,
    );
    expect(ids(applyMove(snapshot(TASKS), "HM-2", { status: "todo", parent: null })).at(-1)).toBe(
      "HM-2",
    );
    expect(ids(applyMove(snapshot(TASKS), "HM-2", { before: "HM-1" }))[0]).toBe("HM-2");
  });

  it("removes a deep subtree from 5,000 tasks within a frame budget", () => {
    const chain = Array.from({ length: 5000 }, (_, index) =>
      task(`HM-${index + 1}`, { parent: index === 0 ? null : `HM-${index}` }),
    );
    const start = performance.now();
    expect(descendantCount(chain, "HM-2")).toBe(4998);
    expect(withoutSubtree(chain, "HM-2").map((entry) => entry.id)).toEqual(["HM-1"]);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("stops at a parent cycle", () => {
    const cycle = [
      task("HM-1", { parent: "HM-2" }),
      task("HM-2", { parent: "HM-1" }),
      task("HM-3"),
    ];
    expect(descendantCount(cycle, "HM-1")).toBe(1);
    expect(withoutSubtree(cycle, "HM-1").map((entry) => entry.id)).toEqual(["HM-3"]);
  });
});

describe("changing blockers before the server answers", () => {
  it("sets the task's blocked state and the blockers' blocks, as the next read will", () => {
    const before = snapshot([
      task("HM-1", { status: "done", blocks: ["HM-4"] }),
      task("HM-2", { blocks: ["HM-3"] }),
      task("HM-3", { blockedBy: ["HM-2"], blocked: true }),
      task("HM-4", { blockedBy: ["HM-1"] }),
    ]);
    const view = (tasks: ReadonlyArray<Task>) =>
      tasks.map(({ id, blockedBy, blocked, blocks }) => ({ id, blockedBy, blocked, blocks }));
    expect(view(withBlockedBy(before, "HM-4", ["HM-1", "HM-2"]).tasks)).toEqual([
      { id: "HM-1", blockedBy: [], blocked: false, blocks: ["HM-4"] },
      { id: "HM-2", blockedBy: [], blocked: false, blocks: ["HM-3", "HM-4"] },
      { id: "HM-3", blockedBy: ["HM-2"], blocked: true, blocks: [] },
      { id: "HM-4", blockedBy: ["HM-1", "HM-2"], blocked: true, blocks: [] },
    ]);
    expect(view(withBlockedBy(before, "HM-4", ["HM-9"]).tasks).at(-1)).toEqual({
      id: "HM-4",
      blockedBy: ["HM-9"],
      blocked: true,
      blocks: [],
    });
    expect(view(withBlockedBy(before, "HM-4", []).tasks)[0]!.blocks).toEqual([]);
  });
});

describe("due dates", () => {
  it("groups a due date-time by its date", () => {
    const today = TODAY;
    const tasks = [task("HM-1", { due: `${today}T23:00` }), task("HM-2", { due: today })];
    expect(
      filterTasks(snapshot(tasks), SMART.today, kindDay, TODAY).map((found) => found.id),
    ).toEqual(["HM-1", "HM-2"]);
    expect(dueInfo(`${today}T23:00`, TODAY)).toMatchObject({ label: "Today", today: true });
    expect(dueInfo(`${today}T00:30+14:00`, TODAY)).toMatchObject({
      label: "Today",
      overdue: false,
    });
  });

  it("labels a due day by the day it is shown on, so a page left open moves on at midnight", () => {
    const due = "2026-10-29";
    expect(dueInfo(due, "2026-10-28")).toEqual({ label: "Tomorrow", today: false, overdue: false });
    expect(dueInfo(due, "2026-10-29")).toEqual({ label: "Today", today: true, overdue: false });
    expect(dueInfo(due, "2026-10-30")).toEqual({ label: "Yesterday", today: false, overdue: true });
    expect(dueInfo(due, "2026-11-02")).toEqual({ label: "Oct 29", today: false, overdue: true });
    expect(dueInfo(due, "2027-01-01")?.label).toBe("Oct 29, 2026");
    const tasks = [task("HM-1", { due })];
    const today = (on: string) =>
      filterTasks(snapshot(tasks), SMART.today, kindDay, on).map((found) => found.id);
    expect(today("2026-10-28"), "the evening before").toEqual([]);
    expect(today("2026-10-29"), "after midnight").toEqual(["HM-1"]);
  });

  it("lists a task of a kind by its kind's day, never its due, as list_tasks' due_by does", () => {
    const now = new Date();
    const day = (offset: number) => format(addDays(now, offset), "yyyy-MM-dd");
    const recurring = (next: string | null) => ({
      id: "recurring",
      fields: { repeat: "every 3 days", next, last: null, count: 0, recent: [] },
    });
    const tasks = [
      task("HM-1", { due: day(0) }),
      task("HM-2", { kind: recurring(day(0)) }),
      task("HM-3", { kind: recurring(day(-4)) }),
      task("HM-4", { kind: recurring(day(5)) }),
      task("HM-8", { kind: recurring(day(20)), due: day(0) }),
      task("HM-9", { kind: { id: "tally", fields: {} }, due: day(0) }),
      task("HM-10", { due: day(-1) }),
    ];
    const ids = (list: string) =>
      filterTasks(snapshot(tasks), list, kindDay, TODAY).map((found) => found.id);
    expect(ids(SMART.today), "due today, the chores due today and overdue").toEqual([
      "HM-1",
      "HM-2",
      "HM-3",
      "HM-10",
    ]);
    expect(ids(SMART.upcoming), "and what comes back within a week").toEqual([
      "HM-1",
      "HM-2",
      "HM-3",
      "HM-4",
      "HM-10",
    ]);
  });
});

describe("entries in the date views", () => {
  const counter = (id: string, fields: Record<string, unknown>) => ({
    id,
    section: "counters",
    title: id,
    created: null,
    updated: null,
    order: "a0",
    body: "",
    path: `.octodo/counters/${id}/counter.md`,
    extra: {},
    mentions: [],
    mentionedIn: [],
    fields: { type: "yearly", since: null, last: null, date: null, ...fields },
  });
  const entries = [
    counter("HM-20", { date: "1961-11-04" }),
    counter("HM-21", { date: "1961-10-28" }),
    counter("HM-22", { date: "1961-12-25" }),
    counter("HM-23", { type: "since", since: "2026-10-01T10:00:00Z" }),
  ];
  const rows = (list: string | undefined) =>
    dueEntries({ entries }, list, sectionDay, "2026-10-28").map(({ id, day }) => `${id} ${day}`);

  it("lists a yearly counter on its next day in Today and Next 7 days, soonest first", () => {
    expect(rows(SMART.today)).toEqual(["HM-21 2026-10-28"]);
    expect(rows(SMART.upcoming)).toEqual(["HM-21 2026-10-28", "HM-20 2026-11-04"]);
  });

  it("lists no entries in the other views", () => {
    expect(rows(SMART.all)).toEqual([]);
    expect(rows(SMART.ready)).toEqual([]);
    expect(rows("home")).toEqual([]);
  });
});
