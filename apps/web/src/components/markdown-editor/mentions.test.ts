import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyExtensions } from "./body-state.ts";
import {
  completeMention,
  mentionCompletions,
  mentionDecorations,
  setMentionTargets,
  type MentionTarget,
} from "./mentions.ts";

const TARGETS = new Map<string, MentionTarget>([
  ["HM-1", { id: "HM-1", title: "Buy primer", closed: false, own: false }],
  ["HM-2", { id: "HM-2", title: "Paint the bedroom", closed: true, own: false }],
  ["HM-4", { id: "HM-4", title: "The task being edited", closed: false, own: true }],
]);

const create = (doc: string) =>
  EditorState.create({ doc, extensions: bodyExtensions }).update({
    effects: setMentionTargets.of(TARGETS),
  }).state;

const chips = (state: EditorState) => {
  const found: Array<{ from: number; to: number; id: unknown; title: unknown }> = [];
  mentionDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
    const widget: unknown = decoration.spec.widget;
    if (widget !== null && typeof widget === "object" && "id" in widget && "target" in widget) {
      const target: unknown = widget.target;
      const title =
        typeof target === "object" && target !== null && "title" in target
          ? target.title
          : undefined;
      found.push({ from, to, id: widget.id, title });
    }
  });
  return found;
};

describe("mention chips", () => {
  it("draws a chip with the target's title over each [[id]] outside code, keeping every byte", () => {
    const doc = "After [[HM-1]] and [[HM-9]],\r\nnot `[[HM-2]]`\n\n```\n[[HM-2]]\n```\n";
    const state = create(doc);
    expect(chips(state)).toEqual([
      { from: 6, to: 14, id: "HM-1", title: "Buy primer" },
      { from: 19, to: 27, id: "HM-9", title: undefined },
    ]);
    expect(state.doc.toString()).toBe(doc);
  });

  it("titles chips again when the targets change, without touching the text", () => {
    const state = create("[[HM-3]]");
    expect(chips(state)[0]?.title).toBeUndefined();
    const renamed = state.update({
      effects: setMentionTargets.of(
        new Map([["HM-3", { id: "HM-3", title: "Hang pictures", closed: false, own: false }]]),
      ),
    }).state;
    expect(chips(renamed)[0]?.title).toBe("Hang pictures");
    expect(renamed.doc.toString()).toBe("[[HM-3]]");
  });
});

describe("completing [[", () => {
  const complete = (doc: string, pos = doc.length) =>
    mentionCompletions(new CompletionContext(create(doc), pos, false));

  it("offers no completion inside code, where [[ stays text", () => {
    expect(complete("See `[[pai")).not.toBeNull();
    for (const doc of ["```\n[[pai", "See `[[pai` now", "para\n\n    [[pai", "<!-- [[pai"]) {
      const cursor = doc.indexOf("pai") + 3;
      expect({ doc, result: complete(doc, cursor) }).toEqual({ doc, result: null });
    }
  });

  it("offers every task but the one being edited by id and title once [[ is typed", () => {
    const result = complete("See [[pai");
    expect(result?.from).toBe(6);
    expect(result?.options.map((option) => option.label)).toEqual([
      "HM-1 Buy primer",
      "HM-2 Paint the bedroom",
    ]);
    expect(complete("See [pai")).toBeNull();
    expect(complete("See [[HM-1]] ")).toBeNull();
  });

  it("replaces the typed query, and a closing ]] after it, with the mention", () => {
    for (const [doc, cursor] of [
      ["See [[pai", 9],
      ["See [[pai]] now", 9],
    ] as const) {
      const state = create(doc);
      const next = state.update(completeMention(state, { from: 4, to: cursor }, "HM-2")).state;
      expect(next.doc.toString()).toBe(`See [[HM-2]]${doc.slice(cursor).replace(/^\]\]/, "")}`);
      expect(next.selection.main.head).toBe("See [[HM-2]]".length);
    }
  });
});
