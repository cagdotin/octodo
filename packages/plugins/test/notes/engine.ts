import { definePlugin, type KindProblem } from "@octodo/engine";
import { notesShared } from "./shared.ts";

export const notes = definePlugin(notesShared, {
  read: ({ keys, files }) => {
    const problems: Array<KindProblem<"bad-pinned">> = [];
    const pinned = keys["pinned"] ?? false;
    if (typeof pinned !== "boolean")
      problems.push({
        problem: "bad-pinned",
        field: "pinned",
        detail: `pinned is ${JSON.stringify(pinned)}, not true or false`,
      });
    const views = (files.get("views.log") ?? "").split("\n").filter((line) => line !== "");
    return { fields: { pinned: pinned === true, views: views.length }, problems };
  },
  handlers: {
    create_note: (ws, { pinned, ...input }) =>
      ws.createInSection(input, pinned === undefined ? {} : { pinned }),
  },
});
