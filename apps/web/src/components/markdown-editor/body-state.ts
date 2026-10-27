import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import {
  Annotation,
  EditorState,
  type Extension,
  Prec,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { livePreview, toggleTaskOnLine } from "./live-preview.ts";
import { mentions } from "./mentions.ts";

/** Marks a transaction that mirrors the file rather than the user's typing. */
export const fromFile = Annotation.define<true>();

/** Everything the body editor's state needs, DOM-free, so tests can build the same state. */
export const bodyExtensions: Extension = [
  // Only "\n" splits lines, so "\r\n" bodies keep their "\r" bytes instead of being normalised.
  EditorState.lineSeparator.of("\n"),
  markdownLanguage.extension,
  history(),
  EditorView.lineWrapping,
  Prec.high(keymap.of([...markdownKeymap, { key: "Mod-Enter", run: toggleTaskOnLine }])),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  livePreview,
  mentions,
];

/** The smallest change that turns the editor's text into `next`, so the cursor stays put. */
export const syncToFile = (state: EditorState, next: string): TransactionSpec | null => {
  const current = state.doc.toString();
  if (current === next) return null;
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current[start] === next[start]) start++;
  let end = 0;
  while (
    end < shortest - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  return {
    changes: {
      from: start,
      to: current.length - end,
      insert: next.slice(start, next.length - end),
    },
    annotations: [fromFile.of(true), Transaction.addToHistory.of(false)],
  };
};
