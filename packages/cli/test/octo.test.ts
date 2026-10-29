import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("starts, which needs every command to have its own name", () => {
  const octo = fileURLToPath(new URL("../../../bin/octo", import.meta.url));
  const help = execFileSync(octo, ["--help"], { encoding: "utf8" });
  expect(help).toContain("upgrade");
});
