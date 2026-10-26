import { describe, expect, it } from "vitest";
import type { List, StatusDefinition } from "../src/domain.ts";
import {
  classifyFolder,
  compareFolders,
  defaultStatus,
  deriveKey,
  isClosedCategory,
  listFolder,
  listMoveError,
  movedListId,
  sortStatuses,
  statusFolder,
  taskFileName,
} from "../src/layout.ts";

const lists = (...ids: Array<string>): Array<List> =>
  ids.map((id) => {
    const slash = id.lastIndexOf("/");
    return { id, name: id, parent: slash === -1 ? null : id.slice(0, slash), folder: id };
  });

const status = (id: string, category: StatusDefinition["category"]): StatusDefinition => ({
  id,
  name: id,
  category,
});

describe("list moves", () => {
  const tree = lists("garden", "garden/seeds", "garden/seeds/deep", "kitchen", "kitchen/seeds");

  it("allows reordering in place, moving to the top level and nesting within the depth limit", () => {
    expect(listMoveError(tree, "kitchen/seeds", "kitchen")).toBeNull();
    expect(listMoveError(tree, "garden/seeds/deep", null)).toBeNull();
    expect(listMoveError(tree, "kitchen", "garden")).toBeNull();
  });

  it("refuses to move a list into itself or its descendants", () => {
    expect(listMoveError(tree, "garden", "garden")).toBe("A list cannot move inside itself");
    expect(listMoveError(tree, "garden", "garden/seeds/deep")).toBe(
      "A list cannot move inside itself",
    );
  });

  it("counts the moved list's sublists against the three-level limit", () => {
    expect(listMoveError(tree, "kitchen", "garden/seeds")).toBe("Lists nest at most 3 levels deep");
    expect(listMoveError(tree, "kitchen/seeds", "garden/seeds")).toBeNull();
    expect(listMoveError(tree, "garden/seeds", "kitchen/seeds")).toBe(
      "Lists nest at most 3 levels deep",
    );
  });

  it("refuses a move that would give two siblings the same name", () => {
    expect(listMoveError(tree, "kitchen/seeds", "garden")).toBe(
      'There is already a list "garden/seeds"',
    );
    expect(listMoveError(lists("seeds", "garden", "garden/seeds"), "garden/seeds", null)).toBe(
      'There is already a list "seeds"',
    );
  });

  it("renames a moved list under its new parent", () => {
    expect(movedListId("garden/seeds", "kitchen")).toBe("kitchen/seeds");
    expect(movedListId("garden/seeds/deep", null)).toBe("deep");
  });
});

describe("statuses", () => {
  it("orders statuses by category and keeps the given order within one", () => {
    const sorted = sortStatuses([
      status("done", "completed"),
      status("review", "started"),
      status("todo", "unstarted"),
      status("doing", "started"),
      status("icebox", "backlog"),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["icebox", "todo", "review", "doing", "done"]);
  });

  it("files new tasks in the first unstarted status", () => {
    expect(
      defaultStatus([
        status("backlog", "backlog"),
        status("next", "unstarted"),
        status("later", "unstarted"),
      ])?.id,
    ).toBe("next");
  });

  it("falls back to the first status in workflow order without an unstarted one", () => {
    expect(defaultStatus([status("done", "completed"), status("doing", "started")])?.id).toBe(
      "doing",
    );
    expect(defaultStatus([status("done", "completed")])?.id).toBe("done");
    expect(defaultStatus([])).toBeUndefined();
  });

  it("treats completed, canceled and archived as closed", () => {
    expect(
      (["backlog", "unstarted", "started", "completed", "canceled", "archived"] as const).filter(
        (category) => isClosedCategory(category),
      ),
    ).toEqual(["completed", "canceled", "archived"]);
    expect(isClosedCategory(undefined)).toBe(false);
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
    expect(deriveKey("house-move")).toBe("HM");
    expect(deriveKey("Garden")).toBe("GAR");
    expect(deriveKey("My Big Home Project")).toBe("MBHP");
  });

  it("names task files after id and title", () => {
    expect(taskFileName("HM-4", "Fix the Import!")).toBe("HM-4-fix-the-import.md");
  });
});
