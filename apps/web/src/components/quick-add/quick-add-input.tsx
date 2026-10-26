import { completionStatus } from "@codemirror/autocomplete";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { addDays, format, parseISO } from "date-fns";
import { DuePicker } from "@/components/due-picker";
import { parseQuickAdd } from "@/lib/quick-add";
import {
  chips,
  completions,
  menuOpen,
  setChips,
  singleLine,
  theme,
  type Suggestions,
} from "./editor";
import type { QuickAddDraft, QuickAddSuggestions } from "./use-quick-add";

export interface QuickAddInputHandle {
  focus: () => void;
}

interface Props {
  draft: QuickAddDraft;
  suggestions: QuickAddSuggestions;
  /** Enter, or ⌘/Ctrl+Enter with `mod`. */
  onSubmit: (mod: boolean) => void;
  /** Escape while no picker is open. */
  onEscape?: () => void;
  onBlur?: () => void;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  /** Wraps a long title onto more lines instead of scrolling it sideways. */
  wrap?: boolean;
  className?: string;
  ref?: Ref<QuickAddInputHandle>;
}

/** The `due:` words offered: today, tomorrow and the weekdays after, labelled as they parse. */
const dueDays = (now: Date): Suggestions["days"] =>
  ["today", "tomorrow", ...[2, 3, 4, 5, 6].map((offset) => format(addDays(now, offset), "EEEE"))]
    .map((word) => ({
      word: word.toLowerCase(),
      due: parseQuickAdd(`due:${word}`, { lists: [], now }).fields.due,
    }))
    .flatMap(({ word, due }) => (due ? [{ word, label: format(parseISO(due), "EEE d MMM") }] : []));

/** Where the calendar opened from: the span it replaces and the caret it hangs under. */
interface DayPick {
  from: number;
  to: number;
  left: number;
  top: number;
  height: number;
}

/**
 * The quick-add title field: a one-line CodeMirror editor that draws the parsed tokens as chips,
 * completes `/list`, `#tag`, `!priority` and `due:`, and turns a clicked chip back into text.
 * Text goes in and out through `draft`; all parsing happens in `parseQuickAdd`.
 */
export function QuickAddInput({
  draft,
  suggestions,
  label,
  placeholder,
  autoFocus = false,
  wrap = false,
  className,
  ref,
  ...handlers
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const [dayPick, setDayPick] = useState<DayPick | null>(null);
  const latest = useRef({ draft, suggestions, handlers });
  useEffect(() => {
    latest.current = { draft, suggestions, handlers };
  });

  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }), []);

  useEffect(() => {
    const pickDay = (from: number, to: number) => {
      const editor = view.current;
      const coords = editor?.coordsAtPos(from);
      const box = host.current?.getBoundingClientRect();
      if (!coords || !box) return;
      setDayPick({
        from,
        to,
        left: coords.left - box.left,
        top: coords.top - box.top,
        height: coords.bottom - coords.top,
      });
    };
    // Removing a focused editor fires blur in Chromium; that is not the user leaving the field.
    let live = true;
    const editor = new EditorView({
      parent: mount.current!,
      state: EditorState.create({
        doc: latest.current.draft.text,
        selection: { anchor: latest.current.draft.text.length },
        extensions: [
          singleLine,
          wrap ? EditorView.lineWrapping : [],
          placeholderText(placeholder),
          EditorView.contentAttributes.of({
            "aria-label": label,
            enterkeyhint: "done",
            autocapitalize: "sentences",
            autocorrect: "on",
          }),
          chips,
          // Ahead of the completion keymap, which swallows Escape even when no menu shows.
          Prec.highest(
            keymap.of([
              {
                key: "Escape",
                run: (editorView) => {
                  const { onEscape } = latest.current.handlers;
                  if (!onEscape || menuOpen(editorView.state)) return false;
                  onEscape();
                  return true;
                },
              },
            ]),
          ),
          completions(() => ({
            ...latest.current.suggestions,
            days: dueDays(latest.current.draft.now),
            pickDay,
          })),
          keymap.of([
            {
              key: "Enter",
              // A menu about to open owns this Enter; submitting would file a half-typed token.
              run: (editorView) =>
                completionStatus(editorView.state) === "pending" ||
                (latest.current.handlers.onSubmit(false), true),
            },
            { key: "Mod-Enter", run: () => (latest.current.handlers.onSubmit(true), true) },
          ]),
          EditorView.domEventHandlers({
            mousedown: (event, editorView) => {
              const chip = event.target instanceof Element && event.target.closest(".cm-qa-chip");
              if (!chip) return false;
              const at = editorView.posAtDOM(chip);
              const { text, parsed, makePlain } = latest.current.draft;
              const range = parsed.ranges.find(({ from, to }) => from <= at && at < to);
              if (range) makePlain(text.slice(range.from, range.to));
              return false;
            },
            blur: () => {
              if (live) latest.current.handlers.onBlur?.();
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.draft.edited(update.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => {
      live = false;
      editor.destroy();
    };
    // The editor is built once; props it reads later go through `latest`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === draft.text) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: draft.text },
      selection: { anchor: draft.text.length },
    });
    // Only outside changes: `draft.text` can lag behind fast typing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.revision]);

  useEffect(() => {
    view.current?.dispatch({
      effects: setChips.of({ text: draft.text, ranges: draft.parsed.ranges }),
    });
  }, [draft.text, draft.parsed.ranges]);

  const placeDay = (due: string | null) => {
    const editor = view.current;
    if (!editor || !dayPick) return;
    const insert = due === null ? "" : `due:${due} `;
    editor.dispatch({
      changes: { from: dayPick.from, to: dayPick.to, insert },
      selection: { anchor: dayPick.from + insert.length },
    });
  };

  return (
    <div ref={host} className={className} style={{ position: "relative", display: "flex" }}>
      <div ref={mount} style={{ display: "contents" }} />
      {dayPick && (
        <DuePicker
          defaultOpen
          value={null}
          onChange={placeDay}
          onOpenChange={(open) => {
            if (open) return;
            setDayPick(null);
            requestAnimationFrame(() => view.current?.focus());
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: dayPick.left,
              top: dayPick.top,
              height: dayPick.height,
              width: 0,
            }}
          />
        </DuePicker>
      )}
    </div>
  );
}
