import type { Task } from "@octodo/contract";
import { describe, expect, it } from "vitest";
import { creatableKinds, offersDue } from "./task-kind.tsx";

const task = (fields: Partial<Task> = {}): Task => ({
  id: "HM-1",
  title: "HM-1",
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
  path: ".octodo/tasks/HM-1/task.md",
  extra: {},
  blockedBy: [],
  blocks: [],
  blocked: false,
  ready: true,
  mentions: [],
  mentionedIn: [],
  ...fields,
});

const recurring = { id: "recurring", fields: { repeat: "daily", next: null, last: null } };

describe("creatableKinds", () => {
  it("offers the kinds the workspace enables, in config order, and none without plugins", () => {
    expect(creatableKinds({ plugins: ["anniversary", "recurring"] }).map(({ id }) => id)).toEqual([
      "anniversary",
      "recurring",
    ]);
    expect(creatableKinds({})).toEqual([]);
  });

  it("skips an enabled id the app has no web half for", () => {
    expect(creatableKinds({ plugins: ["tally", "counter"] }).map(({ id }) => id)).toEqual([
      "counter",
    ]);
  });
});

describe("offersDue", () => {
  it("offers Due on a plain task, with or without one", () => {
    expect(offersDue(task())).toBe(true);
    expect(offersDue(task({ due: "2026-11-02" }))).toBe(true);
  });

  it("hides Due on a task of a kind, unless it still has one to clear", () => {
    expect(offersDue(task({ kind: recurring }))).toBe(false);
    expect(offersDue(task({ kind: recurring, due: "2026-11-02" }))).toBe(true);
  });
});
