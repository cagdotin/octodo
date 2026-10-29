import { expect, it } from "vitest";
import { renderers } from "../src/render.ts";

it("lists each workspace with its description indented under it", () => {
  const lines = renderers.list_workspaces!(
    [
      {
        id: "house",
        name: "House",
        key: "HM",
        description: "Moving house.\nBoxes, movers and the new lease.",
        root: "/home/me/house",
      },
      { id: "garden", name: "Garden", key: "GAR", root: "/home/me/garden" },
    ],
    () => "",
  );
  expect(lines).toEqual([
    `${"house".padEnd(20)} HM     /home/me/house`,
    "  Moving house.",
    "  Boxes, movers and the new lease.",
    `${"garden".padEnd(20)} GAR    /home/me/garden`,
  ]);
});
