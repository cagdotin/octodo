import {
  autocompletion,
  completionStatus,
  currentCompletions,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { QuickAddRange } from "@/lib/quick-add";

/** What the pickers offer, read on every keystroke so it can change while the editor lives. */
export interface Suggestions {
  lists: ReadonlyArray<{ id: string; label: string }>;
  tags: ReadonlyArray<string>;
  priorities: ReadonlyArray<{ word: string; label: string }>;
  /** `due:` words with the day each means, e.g. `tomorrow` → "Tue 27 Oct". */
  days: ReadonlyArray<{ word: string; label: string }>;
  /** Opens the calendar to replace `[from, to)` with the day picked. */
  pickDay: (from: number, to: number) => void;
}

/** Pasted or dropped newlines become spaces: a title is one line. */
export const singleLine = EditorState.transactionFilter.of((tr) => {
  if (tr.newDoc.lines === 1) return tr;
  const flat = tr.newDoc.toString().replace(/\s*\n\s*/g, " ");
  return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: flat }, sequential: true }];
});

/** The ranges parsed from `text`; dropped when the document has already moved past that text. */
export const setChips = StateEffect.define<{
  text: string;
  ranges: ReadonlyArray<QuickAddRange>;
}>();

const chipMark = (range: QuickAddRange) =>
  Decoration.mark({ class: "cm-qa-chip", attributes: { "data-kind": range.token.kind } }).range(
    range.from,
    range.to,
  );

/** Token ranges drawn as chips. Marks, not widgets, so the text under a chip stays editable. */
export const chips = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, tr) => {
    const next = tr.effects.findLast((effect) => effect.is(setChips));
    if (next === undefined || next.value.text !== tr.newDoc.toString()) {
      return decorations.map(tr.changes);
    }
    return Decoration.set(next.value.ranges.map(chipMark), true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Inserts the completion and a space after it, so the token ends and its chip appears. */
const applyToken = (view: EditorView, completion: Completion, from: number, to: number) => {
  const spaced = view.state.sliceDoc(to, to + 1) === " ";
  const insert = completion.label + (spaced ? "" : " ");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length + (spaced ? 1 : 0) },
    userEvent: "input.complete",
  });
};

/** Equal matches keep the order given (days from today, lists as in the sidebar). */
const inOrder = (index: number) => -Math.min(index, 99);

const optionsFor = (trigger: string, suggestions: Suggestions): Array<Completion> => {
  if (trigger === "due:") {
    return [
      {
        label: "due:",
        displayLabel: "Pick a date…",
        type: "calendar",
        boost: 99,
        apply: (_view, _completion, from, to) => suggestions.pickDay(from, to),
      },
      ...suggestions.days.map(({ word, label }, index) => ({
        label: `due:${word}`,
        detail: label,
        type: "day",
        boost: inOrder(index),
        apply: applyToken,
      })),
    ];
  }
  if (trigger === "/") {
    return suggestions.lists.map(({ id, label }, index) => ({
      label: `/${id}`,
      displayLabel: label,
      type: "list",
      boost: inOrder(index),
      apply: applyToken,
    }));
  }
  if (trigger === "#") {
    return suggestions.tags.map((tag) => ({ label: `#${tag}`, type: "tag", apply: applyToken }));
  }
  return suggestions.priorities.map(({ word, label }, index) => ({
    label: `!${word}`,
    detail: label,
    type: "priority",
    boost: inOrder(index),
    apply: applyToken,
  }));
};

const TOKEN = /^(?:[/#!]|due:)[\w/-]*$/i;

/** One source for every trigger at a word start: `/` lists, `#` tags, `!` priorities, `due:`. */
const tokenCompletions =
  (suggestions: () => Suggestions) =>
  (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/(?:[/#!]|due:)[\w/-]*/i);
    if (word === null) return null;
    if (word.from > 0 && !/\s/.test(context.state.sliceDoc(word.from - 1, word.from))) return null;
    const trigger = /^due:/i.test(word.text) ? "due:" : word.text[0]!;
    const options = optionsFor(trigger, suggestions());
    return options.length === 0 ? null : { from: word.from, options, validFor: TOKEN };
  };

export const completions = (suggestions: () => Suggestions): Extension =>
  autocompletion({
    override: [tokenCompletions(suggestions)],
    icons: false,
    interactionDelay: 0,
    tooltipClass: () => "cm-qa-menu",
  });

/** A completion menu is on screen; "active" alone also covers a result filtered down to nothing. */
export const menuOpen = (state: EditorState) =>
  completionStatus(state) === "active" && currentCompletions(state).length > 0;

/** True when an Escape on `target` belongs to an open completion menu, not to the dialog. */
export const completing = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const view = EditorView.findFromDOM(target);
  return view !== null && menuOpen(view.state);
};

const chip = "color-mix(in srgb, var(--ink) 13%, transparent)";

/** Looks like the plain input it replaces: inherited font and size, no padding or outline. */
export const theme = EditorView.theme({
  "&": { fontSize: "inherit", color: "inherit", minWidth: "0", flex: "1 1 0%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  ".cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-qa-chip": {
    backgroundColor: chip,
    color: "var(--ink)",
    borderRadius: "calc(var(--radius) * 0.4)",
    boxShadow: `0 0 0 1px ${chip}`,
    cursor: "pointer",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  },
  ".cm-tooltip.cm-qa-menu": {
    border: "none",
    borderRadius: "calc(var(--radius) * 0.8)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    backdropFilter: "var(--glass-blur)",
    WebkitBackdropFilter: "var(--glass-blur)",
    boxShadow:
      "0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent), 0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%)",
    padding: "4px",
    marginTop: "4px",
  },
  ".cm-tooltip.cm-qa-menu > ul": {
    fontFamily: "var(--font-sans)",
    fontSize: "0.8125rem",
    lineHeight: "1.25rem",
    fontWeight: "400",
    minWidth: "12rem",
    maxWidth: "min(20rem, calc(100vw - 2rem))",
    maxHeight: "15rem",
  },
  ".cm-tooltip.cm-qa-menu > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "6px 8px",
    borderRadius: "calc(var(--radius) * 0.6)",
  },
  ".cm-tooltip.cm-qa-menu > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-qa-menu .cm-completionLabel": { overflow: "hidden", textOverflow: "ellipsis" },
  ".cm-qa-menu .cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
  ".cm-qa-menu .cm-completionDetail": {
    marginLeft: "auto",
    fontStyle: "normal",
    color: "var(--muted-foreground)",
  },
});
