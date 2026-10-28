import { describe, expect, it } from "vitest";
import { creatableKinds } from "./task-kind.tsx";

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
