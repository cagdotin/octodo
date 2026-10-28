import { InvalidRequest } from "@octodo/contract";
import { definePlugin } from "@octodo/engine";
import { Effect } from "effect";
import { readDay } from "./day.ts";
import { anniversaryShared } from "./shared.ts";

const checkDate = (date: string) => {
  const read = readDay(date);
  return "error" in read
    ? Effect.fail(new InvalidRequest({ message: read.error }))
    : Effect.succeed(read.day);
};

export const anniversary = definePlugin(anniversaryShared, {
  read: ({ keys }) => {
    const read =
      keys["date"] === undefined ? { error: "The task has no date" } : readDay(keys["date"]);
    return "error" in read
      ? {
          fields: { date: null },
          problems: [{ problem: "bad-date", field: "date", detail: read.error }],
        }
      : { fields: { date: read.day }, problems: [] };
  },
  handlers: {
    create_anniversary: (ws, { date, ...input }) =>
      Effect.flatMap(checkDate(date), (day) => ws.createOfKind(input, { date: day })),
    set_anniversary_date: (ws, { id, date }) =>
      Effect.flatMap(checkDate(date), (day) => ws.editOfKind(id, { keys: { date: day } })),
  },
});
