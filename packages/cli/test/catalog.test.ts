import { catalog, pathParams, type Operation } from "@octodo/contract/catalog";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SKILL } from "../src/skill.ts";

const operations = Object.entries(catalog) as Array<[string, Operation]>;

describe("the operation catalog", () => {
  it("names only input fields in its HTTP paths", () => {
    const strays = operations.flatMap(([name, operation]) =>
      pathParams(operation.http)
        .filter((param) => !(param in operation.input.fields))
        .map((param) => `${name}: ${param}`),
    );
    expect(strays).toEqual([]);
  });

  it("is what the skill this repo exports says", () => {
    const exported = new URL("../../../.agents/skills/octodo/SKILL.md", import.meta.url);
    expect(readFileSync(exported, "utf8"), "run `bin/octo skills export`").toBe(SKILL);
  });
});
