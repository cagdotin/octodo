import { describe, expect, it } from "vitest";
import { taskFolderName } from "../src/layout.ts";

describe("folder names", () => {
  it("names task folders after id and title", () => {
    expect(taskFolderName("HM-4", "Fix the Import!")).toBe("HM-4-fix-the-import");
    expect(taskFolderName("HM-5", "!!!")).toBe("HM-5");
  });
});
