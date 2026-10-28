import { definePlugin, type KindProblem } from "@octodo/engine";
import { DateTime, Effect, Option, Schema } from "effect";
import { tallyShared } from "./shared.ts";

const LOG = "tally.log";
const decodeStep = Schema.decodeUnknownOption(tallyShared.keys.fields.step);
const isTime = (line: string) => !Number.isNaN(Date.parse(line));

export const tally = definePlugin(tallyShared, {
  read: ({ keys, files }) => {
    const problems: Array<KindProblem<"bad-step" | "bad-line">> = [];
    const step = Option.getOrElse(decodeStep(keys["step"] ?? 1), () => {
      problems.push({
        problem: "bad-step",
        field: "step",
        detail: `The step ${JSON.stringify(keys["step"])} is not a whole number above 0`,
      });
      return 1;
    });
    const lines = (files.get(LOG) ?? "").split("\n").filter((line) => line !== "");
    for (const [index, line] of lines.entries())
      if (!isTime(line))
        problems.push({
          problem: "bad-line",
          file: LOG,
          detail: `Line ${index + 1} is ${JSON.stringify(line)}, not a time`,
        });
    const bumps = lines.filter(isTime);
    return { fields: { count: bumps.length * step, last: bumps.at(-1) ?? null }, problems };
  },
  handlers: {
    create_tally: (ws, { step, ...input }) => ws.createOfKind(input, { step }),
    bump_tally: (ws, { id }) =>
      Effect.flatMap(DateTime.now, (now) =>
        ws.editOfKind(id, {
          files: { [LOG]: (text) => `${text ?? ""}${DateTime.formatIso(now)}\n` },
        }),
      ),
  },
});
