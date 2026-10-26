import { describe, expect, it } from "vitest";
import { editTaskFile, newTaskFile, patchTaskFile, readTaskFile } from "../src/task-file.ts";

const place = {
  status: "todo",
  list: "garden",
  path: ".octodo/l00-garden/s01-todo/fix-the-gate.md",
};
const now = "2026-10-26T12:00:00.000Z";

const readTask = (text: string) => {
  const read = readTaskFile(text, place);
  if (read._tag !== "Task") throw new Error(`Expected a task, got ${read._tag}`);
  return read.task;
};

describe("readTaskFile", () => {
  it("reads managed keys into the task and keeps the rest as extra", () => {
    const task = readTask(
      "---\nid: GA-1\ntitle: Fix the gate\npriority: high\ntags: [a, b]\ndue: 2026-11-01\nestimate: 3\n---\n\nBody text\n",
    );
    expect(task).toEqual({
      id: "GA-1",
      title: "Fix the gate",
      status: "todo",
      list: "garden",
      priority: "high",
      tags: ["a", "b"],
      due: "2026-11-01",
      created: null,
      updated: null,
      order: "",
      body: "Body text\n",
      path: place.path,
      extra: { estimate: 3 },
    });
  });

  it("accepts a single tag written as a string", () => {
    expect(readTask("---\nid: GA-1\ntags: solo\n---\n").tags).toEqual(["solo"]);
  });

  it("reads an unknown priority as none", () => {
    expect(readTask("---\nid: GA-1\npriority: bogus\n---\n").priority).toBe("none");
  });

  it("titles a task without a title after its file name", () => {
    expect(readTask("---\nid: GA-1\n---\n").title).toBe("Fix The Gate");
  });

  it("reports a file without an id, including one without frontmatter", () => {
    expect(readTaskFile("---\ntitle: New\n---\n", place)).toEqual({ _tag: "MissingId" });
    expect(readTaskFile("# Just notes\n", place)).toEqual({ _tag: "MissingId" });
  });

  it("reports invalid YAML", () => {
    const read = readTaskFile("---\ntitle: [unclosed\n---\n", place);
    expect(read._tag).toBe("Invalid");
    expect(read._tag === "Invalid" && read.message).toContain("Invalid frontmatter");
  });
});

describe("writing task files", () => {
  it("writes a new task with defaults and no due key when there is no due date", () => {
    expect(
      newTaskFile({ title: "Fix the gate", due: null }, { id: "GA-1", order: "a0", now }),
    ).toBe(
      `---\nid: GA-1\ntitle: Fix the gate\npriority: none\ntags: []\ncreated: ${now}\nupdated: ${now}\norder: a0\n---\n`,
    );
  });

  it("keeps unknown keys, their order and comments when updating", () => {
    const original = "---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: Old\n---\n\nBody\n";
    expect(editTaskFile(original, { title: "New", priority: "high" }, now)).toBe(
      `---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: New\nupdated: ${now}\npriority: high\n---\n\nBody\n`,
    );
  });

  it("removes the due key when due is set to null, and replaces the body", () => {
    expect(
      editTaskFile("---\nid: GA-1\ndue: 2026-01-01\n---\nold\n", { due: null, body: "new" }, now),
    ).toBe(`---\nid: GA-1\nupdated: ${now}\n---\n\nnew\n`);
  });

  it("round-trips: what an update writes reads back as the edited task", () => {
    const text = editTaskFile(
      "---\nid: GA-1\nestimate: 3\n---\n",
      { title: "Fix it", tags: ["x"], due: "2026-12-24" },
      now,
    );
    expect(readTask(text)).toMatchObject({
      title: "Fix it",
      tags: ["x"],
      due: "2026-12-24",
      updated: now,
      extra: { estimate: 3 },
    });
  });

  it("adds an id to a hand-written file without touching anything else", () => {
    expect(patchTaskFile("Just notes\n", { id: "GA-7" })).toBe(
      "---\nid: GA-7\n---\n\nJust notes\n",
    );
  });
});
