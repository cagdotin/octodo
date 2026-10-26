import { describe, expect, it } from "vitest";
import { parseTaskFile, writeTaskFile } from "../src/markdown.ts";
import { classifyFolder, deriveKey, taskFileName } from "../src/layout.ts";

describe("markdown", () => {
  it("parses frontmatter and body", () => {
    const file = parseTaskFile("---\nid: CT-1\ntitle: Hello\n---\n\nBody text\n");
    expect(file.data).toEqual({ id: "CT-1", title: "Hello" });
    expect(file.body).toBe("Body text\n");
  });

  it("treats a file without frontmatter as all body", () => {
    expect(parseTaskFile("# Just notes\n")).toEqual({ data: {}, body: "# Just notes\n" });
  });

  it("keeps unknown keys, their order and comments when rewriting", () => {
    const original = "---\n# owner note\nestimate: 3 # points\nid: CT-1\ntitle: Old\n---\n\nBody\n";
    const next = writeTaskFile(original, { title: "New", priority: "high" });
    expect(next).toBe(
      "---\n# owner note\nestimate: 3 # points\nid: CT-1\ntitle: New\npriority: high\n---\n\nBody\n",
    );
  });

  it("removes keys set to undefined and replaces the body", () => {
    expect(
      writeTaskFile("---\nid: CT-1\ndue: 2026-01-01\n---\nold\n", { due: undefined }, "new"),
    ).toBe("---\nid: CT-1\n---\n\nnew\n");
  });
});

describe("layout", () => {
  it("classifies folders by prefix", () => {
    const kinds = { c: "Category", p: "Project" };
    expect(classifyFolder("s-in-progress", kinds)).toEqual({ type: "status", id: "in-progress" });
    expect(classifyFolder("c-groceries", kinds)).toEqual({
      type: "list",
      kind: "c",
      slug: "groceries",
    });
    expect(classifyFolder("x-thing", kinds)).toEqual({ type: "unknown" });
    expect(classifyFolder(".git", kinds)).toEqual({ type: "ignored" });
  });

  it("derives Linear-style keys", () => {
    expect(deriveKey("house-move")).toBe("CT");
    expect(deriveKey("Garden")).toBe("GAR");
    expect(deriveKey("My Big Home Project")).toBe("MBHP");
  });

  it("names task files after id and title", () => {
    expect(taskFileName("CT-4", "Fix the Import!")).toBe("CT-4-fix-the-import.md");
  });
});
