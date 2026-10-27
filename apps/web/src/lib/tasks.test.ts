import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { DEFAULT_STATUSES } from "@octodo/core";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  descendantCount,
  filterTasks,
  listCounts,
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
  it("shows only top-level tasks in lists and smart views", () => {
    expect(filterTasks(TASKS, undefined).map((entry) => entry.id)).toEqual(["HM-1", "HM-5"]);
    expect(filterTasks(TASKS, "home").map((entry) => entry.id)).toEqual(["HM-1"]);
    expect(listCounts(snapshot(TASKS)).counts.get("home")).toBe(1);
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
});
