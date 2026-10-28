import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { newFrontmatter, patchFrontmatter } from "../src/frontmatter.ts";
import { newListFile, readListFile } from "../src/lists/list-file.ts";
import { editTaskFile, newTaskFile, readTaskFile } from "../src/tasks/task-file.ts";
import type { AssignedId } from "../src/storage/storage.ts";

const edit = (...args: Parameters<typeof editTaskFile>) => Effect.runSync(editTaskFile(...args));
const patch = (...args: Parameters<typeof patchFrontmatter>) =>
  Effect.runSync(patchFrontmatter(...args));

/** Only storage mints an assigned id; these tests write fixed ones. */
const assigned = (id: string) => id as AssignedId;

const place = {
  list: "garden",
  parent: "GA-9",
  path: ".octodo/garden/GA-9-fence/GA-1-fix-the-gate/task.md",
  folder: "GA-1-fix-the-gate",
  defaultStatus: "todo",
  updated: "2026-10-26T13:00:00.000Z",
  key: "GA",
};
const now = "2026-10-26T12:00:00.000Z";

const readTask = (text: string) => {
  const read = readTaskFile(text, place);
  if (read._tag !== "Read") throw new Error(`Expected a task, got ${read._tag}`);
  return read.value;
};

describe("readTaskFile", () => {
  it("reads managed keys into the task, takes place and mtime from the tree, keeps the rest", () => {
    const task = readTask(
      "---\nid: GA-1\ntitle: Fix the gate\nstatus: done\npriority: high\ntags: [a, b]\ndue: 2026-11-01\nupdated: 2020-01-01\nestimate: 3\n---\n\nBody text\n",
    );
    expect(task).toEqual({
      id: "GA-1",
      title: "Fix the gate",
      status: "done",
      list: "garden",
      parent: "GA-9",
      priority: "high",
      tags: ["a", "b"],
      due: "2026-11-01",
      created: null,
      updated: place.updated,
      order: "",
      body: "Body text\n",
      path: place.path,
      extra: { estimate: 3 },
      blockedBy: [],
      mentions: [],
    });
  });

  it("reads a task without a status as the default status", () => {
    expect(readTask("---\nid: GA-1\n---\n").status).toBe("todo");
  });

  it("accepts a single tag written as a string", () => {
    expect(readTask("---\nid: GA-1\ntags: solo\n---\n").tags).toEqual(["solo"]);
  });

  it("reads an unknown priority as none and reports it", () => {
    const read = readTaskFile("---\nid: GA-1\npriority: bogus\n---\n", place);
    expect(read).toMatchObject({
      _tag: "Read",
      value: { priority: "none" },
      problems: [{ kind: "unknown-priority", field: "priority" }],
    });
  });

  it("decodes due dates and tags strictly, reporting each bad one", () => {
    const problems = (text: string) => {
      const read = readTaskFile(text, place);
      return read._tag === "Read" ? read.problems.map((problem) => problem.kind) : read._tag;
    };
    expect(problems("---\nid: GA-1\ndue: 2026-11-01\ntags: [a, b]\n---\n")).toEqual([]);
    expect(problems("---\nid: GA-1\ndue: 2026-13-01\n---\n")).toEqual(["invalid-due"]);
    expect(problems("---\nid: GA-1\ndue: tomorrow\n---\n")).toEqual(["invalid-due"]);
    expect(problems("---\nid: GA-1\ndue: 2026-02-31\n---\n")).toEqual(["invalid-due"]);
    expect(problems("---\nid: GA-1\ntags: [a, 2]\n---\n")).toEqual([]);
    expect(problems("---\nid: GA-1\ntags: [a, {b: 1}]\n---\n")).toEqual(["invalid-tags"]);
    expect(problems("---\nid: GA-1\ndue:\ntags:\n---\n")).toEqual([]);
  });

  it("refuses an id that is not a task id", () => {
    for (const id of ["42", "groceries", "GA-", "[a]"])
      expect(readTaskFile(`---\nid: ${id}\n---\n`, place)).toMatchObject({
        _tag: "Invalid",
        problem: { kind: "malformed-id", field: "id" },
      });
  });

  it("titles a task without a title after its folder name", () => {
    expect(readTask("---\nid: GA-1\n---\n").title).toBe("Fix The Gate");
  });

  it("reports a file without an id, including one without frontmatter", () => {
    expect(readTaskFile("---\ntitle: New\n---\n", place)).toEqual({ _tag: "MissingId" });
    expect(readTaskFile("# Just notes\n", place)).toEqual({ _tag: "MissingId" });
  });

  it("reports invalid YAML", () => {
    const read = readTaskFile("---\ntitle: [unclosed\n---\n", place);
    expect(read._tag).toBe("Invalid");
    expect(read).toMatchObject({ _tag: "Invalid", problem: { kind: "invalid-frontmatter" } });
  });
});

describe("writing task files", () => {
  it("writes a new task with its status and leaves default fields out", () => {
    expect(
      newTaskFile(
        { title: "Fix the gate", due: null, tags: [], priority: "none" },
        { id: assigned("GA-1"), status: "todo", order: "a0", now },
      ),
    ).toBe(`---\nid: GA-1\ntitle: Fix the gate\nstatus: todo\ncreated: ${now}\norder: a0\n---\n`);
  });

  it("writes set fields and the body", () => {
    expect(
      newTaskFile(
        { title: "Gate", priority: "high", tags: ["x"], due: "2026-11-01", body: "Notes" },
        { id: assigned("GA-1"), status: "todo", order: "a0", now },
      ),
    ).toBe(
      `---\nid: GA-1\ntitle: Gate\nstatus: todo\npriority: high\ntags:\n  - x\ndue: 2026-11-01\ncreated: ${now}\norder: a0\n---\n\nNotes\n`,
    );
  });

  it("keeps unknown keys, their order and comments when updating, and writes no updated key", () => {
    const original = "---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: Old\n---\n\nBody\n";
    expect(edit(original, { title: "New", priority: "high" })).toBe(
      "---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: New\npriority: high\n---\n\nBody\n",
    );
  });

  it("leaves the lines of keys an edit does not touch byte for byte, flow lists included", () => {
    const text =
      "---\nid: GA-1\ntitle: Fix the gate\ntags: [a, b]\nblocked_by: [GA-2, GA-3]\n---\n";
    expect(edit(text, { title: "Mend the gate", priority: "high" })).toBe(
      "---\nid: GA-1\ntitle: Mend the gate\ntags: [a, b]\nblocked_by: [GA-2, GA-3]\npriority: high\n---\n",
    );
  });

  it("removes a field set back to its default, and replaces the body", () => {
    expect(
      edit("---\nid: GA-1\npriority: high\ntags: [a]\ndue: 2026-01-01\n---\nold\n", {
        due: null,
        priority: "none",
        tags: [],
        body: "new",
      }),
    ).toBe("---\nid: GA-1\n---\n\nnew\n");
  });

  it("keeps a title that reads like a default value", () => {
    expect(edit("---\nid: GA-1\n---\n", { title: "none" })).toBe(
      "---\nid: GA-1\ntitle: none\n---\n",
    );
  });

  it("round-trips: what an update writes reads back as the edited task", () => {
    const text = edit("---\nid: GA-1\nestimate: 3\n---\n", {
      title: "Fix it",
      tags: ["x"],
      due: "2026-12-24",
    });
    expect(readTask(text)).toMatchObject({
      title: "Fix it",
      tags: ["x"],
      due: "2026-12-24",
      extra: { estimate: 3 },
    });
  });

  it("round-trips a title ending in --- with the keys after it", () => {
    const text = edit(
      "---\nid: GA-1\ntitle: Notes ---\ncreated: 2026-10-01T00:00:00.000Z\norder: a0\n---\n\nBody\n",
      { priority: "high" },
    );
    expect(readTask(text)).toMatchObject({
      title: "Notes ---",
      priority: "high",
      created: "2026-10-01T00:00:00.000Z",
      order: "a0",
      body: "Body\n",
    });
  });

  it("adds an id to a hand-written file without touching anything else", () => {
    expect(patch("Just notes\n", { id: assigned("GA-7") })).toBe(
      "---\nid: GA-7\n---\n\nJust notes\n",
    );
  });

  it("writes only an id the owner-lock holder assigned", () => {
    // @ts-expect-error a plain string is not an assigned id
    const written = newFrontmatter({ id: "GA-7" });
    expect(written, "the type refuses it, not the runtime").toBe("---\nid: GA-7\n---\n");
  });
});

describe("list files", () => {
  it("writes name and order and reads them back with the body", () => {
    const text = newListFile({ name: "Seeds & bulbs", order: "a1" });
    expect(text).toBe("---\nname: Seeds & bulbs\norder: a1\n---\n");
    expect(readListFile(`${text}\nWhat goes in the ground.\n`)).toEqual({
      _tag: "Read",
      value: { name: "Seeds & bulbs", order: "a1", body: "What goes in the ground.\n" },
    });
  });

  it("reads an empty list file as no name and no order", () => {
    expect(readListFile("")).toEqual({ _tag: "Read", value: { name: null, order: "", body: "" } });
  });
});
