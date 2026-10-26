import { describe, expect, it } from "vitest";
import { checklistProgress } from "./checklist.ts";

describe("checklistProgress", () => {
  it("counts checked and unchecked items, nested and ordered ones included", () => {
    const body = [
      "# Plan",
      "- [x] buy seeds",
      "- [ ] dig beds",
      "  - [X] north bed",
      "  * [ ] south bed",
      "1. [ ] water",
      "> - [x] quoted",
    ].join("\n");
    expect(checklistProgress(body)).toEqual({ done: 3, total: 6 });
  });

  it("ignores items inside fenced code and bracket text that is not a task marker", () => {
    const body = [
      "```md",
      "- [x] example in a fence",
      "```",
      "~~~~",
      "- [ ] tilde fence",
      "~~~",
      "- [ ] still fenced, the closer was too short",
      "~~~~",
      "- [ ] real",
      "- [y] not a marker",
      "- [x]glued to text",
      "[ ] no list marker",
    ].join("\n");
    expect(checklistProgress(body)).toEqual({ done: 0, total: 1 });
  });

  it("returns null when the body has no checklist", () => {
    expect(checklistProgress("")).toBeNull();
    expect(checklistProgress("- plain bullet\n- another")).toBeNull();
  });

  it("reads CRLF bodies", () => {
    expect(checklistProgress("- [x] one\r\n- [ ] two\r\n")).toEqual({ done: 1, total: 2 });
  });
});
