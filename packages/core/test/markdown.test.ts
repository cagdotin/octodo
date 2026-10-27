import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  editTaskFile,
  newListFile,
  newTaskFile,
  patchFrontmatter,
  readFrontmatter,
  readListFile,
  readTaskFile,
} from "../src/markdown.ts";

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
        { id: "GA-1", status: "todo", order: "a0", now },
      ),
    ).toBe(`---\nid: GA-1\ntitle: Fix the gate\nstatus: todo\ncreated: ${now}\norder: a0\n---\n`);
  });

  it("writes set fields and the body", () => {
    expect(
      newTaskFile(
        { title: "Gate", priority: "high", tags: ["x"], due: "2026-11-01", body: "Notes" },
        { id: "GA-1", status: "todo", order: "a0", now },
      ),
    ).toBe(
      `---\nid: GA-1\ntitle: Gate\nstatus: todo\npriority: high\ntags:\n  - x\ndue: 2026-11-01\ncreated: ${now}\norder: a0\n---\n\nNotes\n`,
    );
  });

  it("keeps unknown keys, their order and comments when updating, and writes no updated key", () => {
    const original = "---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: Old\n---\n\nBody\n";
    expect(editTaskFile(original, { title: "New", priority: "high" })).toBe(
      "---\n# owner note\nestimate: 3 # points\nid: GA-1\ntitle: New\npriority: high\n---\n\nBody\n",
    );
  });

  it("leaves the lines of keys an edit does not touch byte for byte, flow lists included", () => {
    const text =
      "---\nid: GA-1\ntitle: Fix the gate\ntags: [a, b]\nblocked_by: [GA-2, GA-3]\n---\n";
    expect(editTaskFile(text, { title: "Mend the gate", priority: "high" })).toBe(
      "---\nid: GA-1\ntitle: Mend the gate\ntags: [a, b]\nblocked_by: [GA-2, GA-3]\npriority: high\n---\n",
    );
  });

  it("removes a field set back to its default, and replaces the body", () => {
    expect(
      editTaskFile("---\nid: GA-1\npriority: high\ntags: [a]\ndue: 2026-01-01\n---\nold\n", {
        due: null,
        priority: "none",
        tags: [],
        body: "new",
      }),
    ).toBe("---\nid: GA-1\n---\n\nnew\n");
  });

  it("keeps a title that reads like a default value", () => {
    expect(editTaskFile("---\nid: GA-1\n---\n", { title: "none" })).toBe(
      "---\nid: GA-1\ntitle: none\n---\n",
    );
  });

  it("round-trips: what an update writes reads back as the edited task", () => {
    const text = editTaskFile("---\nid: GA-1\nestimate: 3\n---\n", {
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

  it("adds an id to a hand-written file without touching anything else", () => {
    expect(patchFrontmatter("Just notes\n", { id: "GA-7" })).toBe(
      "---\nid: GA-7\n---\n\nJust notes\n",
    );
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

describe("frontmatter", () => {
  /** What the YAML parser alone reads: the data, or "error" where readFrontmatter fails. */
  const parsed = (yaml: string) => {
    const doc = parseDocument(yaml);
    if (doc.errors.length > 0) return "error";
    try {
      const value: unknown = doc.toJS();
      if (value === null) return {};
      return typeof value === "object" && !Array.isArray(value) ? value : "error";
    } catch {
      return "error";
    }
  };

  it("reads a key at and past YAML's 1024-character limit as the YAML parser does", () => {
    for (const length of [1000, 1022, 1023, 1024, 1025, 1100]) {
      const yaml = `${"k".repeat(length)}: x`;
      const read = readFrontmatter(`---\n${yaml}\n---\n`);
      expect({ length, read: "error" in read ? "error" : read.data }).toEqual({
        length,
        read: parsed(yaml),
      });
    }
  });

  it("reads every frontmatter as the YAML parser does", () => {
    const keys = ["id", "title", "a_b", "x-1", "_x", "null", "True", "false", "__proto__", "1a"];
    const tricky = ["-a", "a b", "~", "a#", "Id", "ID"];
    const separators = [":", ":  ", " : ", ":\t"];
    const values = [
      "x",
      "Fix the gate",
      "x ",
      " x",
      "a: b",
      "a:b",
      "a:",
      "a #c",
      "a#c",
      "#c",
      "C#",
      "'q'",
      '"q"',
      "a'b",
      'a"b',
      "[a, b]",
      "{a: 1}",
      "a [b]",
      "a {b}",
      "- a",
      "-a",
      "-1",
      "+1",
      "1",
      "007",
      "1.5",
      ".5",
      "5.",
      "1e3",
      "1E-3",
      "+.inf",
      ".inf",
      ".NaN",
      ".nan",
      "0o17",
      "0o8",
      "0x1F",
      "0xG",
      "~",
      "null",
      "Null",
      "NULL",
      "nULL",
      "true",
      "TRUE",
      "tRue",
      "yes",
      "off",
      "2026-10-27",
      "2026-10-27T00:00:00.000Z",
      "12:30",
      "a\tb",
      "é",
      "😀",
      "a b",
      "﻿x",
      "a\u0085b",
      "a\\nb",
      "*a",
      "&a",
      "!a",
      "!!str a",
      "|",
      ">",
      "%a",
      "@a",
      "`a",
      "?a",
      "? a",
      ",a",
      "a,b",
      "a , b",
      "a  b",
      "a\u0000b",
      "a: b: c",
      "a :b",
      "a - b",
      "a0V",
      "%",
      "=",
      "<<",
      "a?",
      "a!",
      "a\t",
      "a:\tb",
      "a\rb",
      String.fromCodePoint(0xa0, 0x61),
      `a${String.fromCodePoint(0xa0)}`,
      `a${String.fromCodePoint(0x3000)}`,
      `a${String.fromCodePoint(0xfffe)}b`,
      `a${String.fromCharCode(0xd800)}b`,
      `a${String.fromCodePoint(0x7f)}b`,
    ];
    const lines = ["", "  indented", "# comment", "...", "- item", "key:", "%YAML 1.1", "a: b # c"];
    let seed = 42;
    const pick = <A>(items: ReadonlyArray<A>): A => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return items[(seed >>> 8) % items.length]!;
    };
    const chance = (one: number) => pick(Array.from({ length: one }, (_, i) => i)) === 0;
    let plain = 0;
    const differences: Array<{ yaml: string; read: unknown; parsed: unknown }> = [];
    for (let i = 0; i < 5_000; i++) {
      const yaml = Array.from({ length: 1 + (i % 4) }, () =>
        chance(10)
          ? pick(lines)
          : `${pick(chance(5) ? tricky : keys)}${chance(4) ? pick(separators) : ": "}${pick(values)}${chance(4) ? pick(values) : ""}`,
      ).join("\n");
      const result = readFrontmatter(`---\n${yaml}\n---\n`);
      const read = "error" in result ? "error" : result.data;
      const expected = parsed(yaml);
      if (expected !== "error" && Object.values(expected).every((v) => typeof v === "string"))
        plain++;
      if (JSON.stringify(read) !== JSON.stringify(expected))
        differences.push({ yaml, read, parsed: expected });
    }
    expect(differences.slice(0, 5)).toEqual([]);
    expect(plain, "a good share of cases are plain strings").toBeGreaterThan(500);
  });
});
