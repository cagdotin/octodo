import { describe, expect, it } from "vitest";
import { parseTaskFile, writeTaskFile } from "../src/markdown.ts";
import {
  classifyFolder,
  compareFolders,
  deriveKey,
  listFolder,
  statusFolder,
  taskFileName,
} from "../src/layout.ts";

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
  it("classifies folders by prefix and reads their number", () => {
    expect(classifyFolder("s02-in-progress")).toEqual({
      type: "status",
      slug: "in-progress",
      position: 2,
    });
    expect(classifyFolder("l00-groceries")).toEqual({
      type: "list",
      slug: "groceries",
      position: 0,
    });
    expect(classifyFolder("l-groceries")).toEqual({
      type: "list",
      slug: "groceries",
      position: null,
    });
    expect(classifyFolder("p-thing")).toEqual({ type: "unknown" });
    expect(classifyFolder("notes")).toEqual({ type: "unknown" });
    expect(classifyFolder(".git")).toEqual({ type: "ignored" });
  });

  it("sorts numbered folders first, then by slug", () => {
    const folders = [
      { slug: "b", position: null },
      { slug: "c", position: 1 },
      { slug: "a", position: null },
      { slug: "d", position: 0 },
    ];
    expect(folders.toSorted(compareFolders).map((folder) => folder.slug)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
    expect(listFolder(3, "garden")).toBe("l03-garden");
    expect(statusFolder(12, "done")).toBe("s12-done");
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
