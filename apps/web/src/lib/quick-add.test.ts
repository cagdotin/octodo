import { describe, expect, test } from "vitest";
import {
  parseQuickAdd,
  withoutRanges,
  type QuickAddContext,
  type QuickAddFields,
} from "./quick-add.ts";

/** Monday 26 October 2026, 10:00 local time. */
const now = new Date(2026, 9, 26, 10, 0);
const context: QuickAddContext = {
  now,
  lists: [{ id: "garden" }, { id: "garden/seeds" }, { id: "home" }, { id: "work/seeds" }],
};

const cases: ReadonlyArray<{ text: string; title: string; fields: Partial<QuickAddFields> }> = [
  { text: "Water the plants", title: "Water the plants", fields: {} },
  { text: "Ship it !high", title: "Ship it", fields: { priority: "high" } },
  { text: "Ship it !1", title: "Ship it", fields: { priority: "urgent" } },
  { text: "Ship it !MED", title: "Ship it", fields: { priority: "medium" } },
  { text: "Ship it !none", title: "Ship it", fields: { priority: "none" } },
  { text: "Ship it !soon", title: "Ship it !soon", fields: {} },
  { text: "!low then !high", title: "then", fields: { priority: "high" } },
  {
    text: "Paint #home-office #paint #paint",
    title: "Paint",
    fields: { tags: ["home-office", "paint"] },
  },
  { text: "C# is #lang/dotnet", title: "C# is", fields: { tags: ["lang/dotnet"] } },
  { text: "Rake leaves /garden", title: "Rake leaves", fields: { list: "garden" } },
  { text: "Sow /Garden/Seeds now", title: "Sow now", fields: { list: "garden/seeds" } },
  { text: "Sow /home and /garden", title: "Sow and", fields: { list: "garden" } },
  { text: "Edit /etc/hosts", title: "Edit /etc/hosts", fields: {} },
  { text: "Ambiguous /seeds", title: "Ambiguous /seeds", fields: {} },
  { text: "and/or stays", title: "and/or stays", fields: {} },
  { text: "Pay rent due:2026-11-01", title: "Pay rent", fields: { due: "2026-11-01" } },
  { text: "Pay rent due:today", title: "Pay rent", fields: { due: "2026-10-26" } },
  { text: "Pay rent DUE:tmr", title: "Pay rent", fields: { due: "2026-10-27" } },
  { text: "Pay rent due:friday", title: "Pay rent", fields: { due: "2026-10-30" } },
  { text: "Pay rent due:2026-13-45", title: "Pay rent due:2026-13-45", fields: {} },
  { text: "Pay rent due:", title: "Pay rent due:", fields: {} },
  { text: "Due: friday call", title: "Due: call", fields: { due: "2026-10-30" } },
  { text: "Buy primer tomorrow 5pm", title: "Buy primer", fields: { due: "2026-10-27" } },
  { text: "Call mom on friday", title: "Call mom", fields: { due: "2026-10-30" } },
  { text: "Call mom at 3", title: "Call mom", fields: { due: "2026-10-26" } },
  { text: "Feed cat at 9", title: "Feed cat", fields: { due: "2026-10-27" } },
  { text: "Dentist next fri at 3", title: "Dentist", fields: { due: "2026-11-06" } },
  { text: "Dinner tonight", title: "Dinner", fields: { due: "2026-10-26" } },
  { text: "Review in 2 days", title: "Review", fields: { due: "2026-10-28" } },
  { text: "Taxes may 5", title: "Taxes", fields: { due: "2027-05-05" } },
  {
    text: "Due:tomorrow beats next friday",
    title: "beats next friday",
    fields: { due: "2026-10-27" },
  },
  { text: "Standup every monday", title: "Standup every monday", fields: {} },
  { text: "Standup every other monday", title: "Standup every other monday", fields: {} },
  { text: "Pills every day at 3", title: "Pills every day at 3", fields: {} },
  { text: "Review each friday", title: "Review each friday", fields: {} },
  { text: "Water every plant tomorrow", title: "Water every plant", fields: { due: "2026-10-27" } },
  { text: "Buy sun screen", title: "Buy sun screen", fields: {} },
  { text: "March madness", title: "March madness", fields: {} },
  { text: "Buy milk now", title: "Buy milk now", fields: {} },
  { text: "Buy 3 apples", title: "Buy 3 apples", fields: {} },
  {
    text: "Buy primer /garden #paint !high tomorrow 5pm",
    title: "Buy primer",
    fields: { list: "garden", tags: ["paint"], priority: "high", due: "2026-10-27" },
  },
];

describe("parseQuickAdd", () => {
  test.each(cases)("$text", ({ text, title, fields }) => {
    const parsed = parseQuickAdd(text, context);
    expect(parsed.title).toBe(title);
    expect(parsed.fields).toEqual({ tags: [], ...fields });
  });

  test("ranges are the exact spans each token matched, in text order", () => {
    const text = "Buy primer /garden #paint !high tomorrow 5pm";
    const spans = parseQuickAdd(text, context).ranges.map(({ from, to, token }) => [
      text.slice(from, to),
      token,
    ]);
    expect(spans).toEqual([
      ["/garden", { kind: "list", list: "garden" }],
      ["#paint", { kind: "tag", tag: "paint" }],
      ["!high", { kind: "priority", priority: "high" }],
      ["tomorrow 5pm", { kind: "due", due: "2026-10-27" }],
    ]);
  });

  test("a token the user made plain stays in the title", () => {
    const plain = new Set(["#paint", "tomorrow 5pm"]);
    const parsed = parseQuickAdd("Buy #paint tomorrow 5pm !high", { ...context, plain });
    expect(parsed.title).toBe("Buy #paint tomorrow 5pm");
    expect(parsed.fields).toEqual({ tags: [], priority: "high" });
  });

  test("without dates, a typed date stays in the title and the other tokens still read", () => {
    const parsed = parseQuickAdd("Water the plants tomorrow due:fri #garden", {
      ...context,
      dates: false,
    });
    expect(parsed.title).toBe("Water the plants tomorrow due:fri");
    expect(parsed.fields).toEqual({ tags: ["garden"] });
  });

  test("a plain natural date lets a later one through", () => {
    const parsed = parseQuickAdd("Call friday or thursday", {
      ...context,
      plain: new Set(["friday"]),
    });
    expect(parsed.fields.due).toBe("2026-10-29");
    expect(parsed.title).toBe("Call friday or");
  });

  test("cutting the ranges out of the text gives the title", () => {
    const text = "  Buy   primer #paint  tomorrow ";
    const parsed = parseQuickAdd(text, context);
    expect(withoutRanges(text, parsed.ranges)).toBe(parsed.title);
    expect(parsed.title).toBe("Buy primer");
  });
});
