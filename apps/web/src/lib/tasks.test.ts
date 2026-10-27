import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { DEFAULT_STATUSES } from "@octodo/core";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  descendantCount,
  filterTasks,
  listCounts,
  SMART,
  subtaskProgress,
  withoutSubtree,
} from "./tasks.ts";

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
  path: `.octodo/${id}/task.md`,
  extra: {},
  ...fields,
});

const snapshot = (tasks: Array<Task>): WorkspaceSnapshot => ({
  workspace: { id: "hm", name: "House", key: "HM", root: "/tmp/house" },
  statuses: DEFAULT_STATUSES,
  lists: [{ id: "home", name: "Home", parent: null, folder: "home" }],
  tasks,
  diagnostics: [],
});

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
    const ids = (list: string | undefined) => filterTasks(tasks, list).map((entry) => entry.id);
    expect(ids(undefined)).toEqual(["HM-1", "HM-5", "HM-7"]);
    expect(ids("home")).toEqual(["HM-1"]);
    expect(ids(SMART.none)).toEqual(["HM-5", "HM-7"]);
    expect(ids(SMART.today)).toEqual(["HM-6", "HM-7"]);
    expect(ids(SMART.upcoming)).toEqual(["HM-6", "HM-7"]);
    expect(listCounts(snapshot(tasks)).counts.get("home")).toBe(1);
  });

  it("counts direct subtasks in a completed status as done", () => {
    const progress = subtaskProgress(snapshot(TASKS));
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
