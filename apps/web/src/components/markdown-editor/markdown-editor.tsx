import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { bodyExtensions, fromFile, syncToFile } from "./body-state.ts";
import { bodyTheme } from "./theme.ts";

interface Props {
  /** The text to show; a new value that differs from the editor's is applied as a minimal change. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}

/** An always-editable markdown editor with Obsidian-style live preview over the exact text. */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  ...aria
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onBlur });
  useLayoutEffect(() => {
    handlers.current = { onChange, onBlur };
  });

  // The view is created once; `value` changes reach it through the sync effect below.
  const initial = useRef({ value, placeholder, label: aria["aria-label"] });
  useEffect(() => {
    const { value: doc, placeholder: hint, label } = initial.current;
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          bodyExtensions,
          bodyTheme,
          hint === undefined ? [] : placeholderText(hint),
          label === undefined ? [] : EditorView.contentAttributes.of({ "aria-label": label }),
          keymap.of([
            {
              key: "Escape",
              run: (target) => {
                target.contentDOM.blur();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            const typed = update.transactions.some(
              (tr) => tr.docChanged && tr.annotation(fromFile) === undefined,
            );
            if (typed) handlers.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({ blur: () => handlers.current.onBlur?.() }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    const spec = editor && syncToFile(editor.state, value);
    if (editor && spec) editor.dispatch(spec);
  }, [value]);

  return <div ref={host} className={cn("min-w-0", className)} />;
}
