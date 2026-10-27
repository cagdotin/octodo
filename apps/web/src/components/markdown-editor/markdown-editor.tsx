import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { imageMarkdown, type Attachments } from "@/lib/attachments";
import { bodyExtensions, fromFile, syncToFile } from "./body-state.ts";
import { imageUrl } from "./live-preview.ts";
import { bodyTheme } from "./theme.ts";

const imagesIn = (data: DataTransfer | null) =>
  [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));

/** A spot in the document that follows the edits made while an upload is on its way. */
interface Anchor {
  pos: number;
}

interface Props {
  /** The text to show; a new value that differs from the editor's is applied as a minimal change. */
  value: string;
  /** Also called after unmount, when an image upload started before then finishes. */
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  /** Lets images be pasted or dropped in, and shows the ones the body links to. */
  attachments?: Attachments;
}

/**
 * An always-editable markdown editor with Obsidian-style live preview over the exact text. It fills
 * its scroll area, so a click anywhere in it lands in the text.
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  attachments,
  ...aria
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onBlur });
  useLayoutEffect(() => {
    handlers.current = { onChange, onBlur };
  });

  // The view is created once; `value` changes reach it through the sync effect below.
  const initial = useRef({ value, placeholder, label: aria["aria-label"], attachments });
  const anchors = useRef(new Set<Anchor>());
  useEffect(() => {
    const { value: doc, placeholder: hint, label, attachments: files } = initial.current;

    /**
     * Uploads the images one by one, each on its own line after the last, starting where the
     * anchor has moved to by then. Once the editor is gone, the text goes straight to onChange.
     */
    const attach = async (target: EditorView, images: ReadonlyArray<File>, pos: number) => {
      if (files === undefined) return;
      const anchor: Anchor = { pos };
      anchors.current.add(anchor);
      let closed: EditorState | undefined;
      try {
        for (const [index, image] of images.entries()) {
          const path = await files.upload(image);
          const from = anchor.pos;
          const insert = `${index === 0 ? "" : "\n"}${imageMarkdown(path)}`;
          const spec: TransactionSpec = { changes: { from, insert }, userEvent: "input.paste" };
          if (view.current === target) target.dispatch(spec);
          else {
            closed = (closed ?? target.state).update(spec).state;
            handlers.current.onChange(closed.doc.toString());
          }
          anchor.pos = from + insert.length;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the image");
      } finally {
        anchors.current.delete(anchor);
      }
    };

    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          bodyExtensions,
          bodyTheme,
          hint === undefined ? [] : placeholderText(hint),
          label === undefined ? [] : EditorView.contentAttributes.of({ "aria-label": label }),
          files === undefined ? [] : imageUrl.of(files.url),
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
            for (const anchor of anchors.current) anchor.pos = update.changes.mapPos(anchor.pos);
            const typed = update.transactions.some(
              (tr) => tr.docChanged && tr.annotation(fromFile) === undefined,
            );
            if (typed) handlers.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => handlers.current.onBlur?.(),
            paste: (event, target) => {
              const images = imagesIn(event.clipboardData);
              if (files === undefined || images.length === 0) return false;
              event.preventDefault();
              void attach(target, images, target.state.selection.main.head);
              return true;
            },
            drop: (event, target) => {
              const images = imagesIn(event.dataTransfer);
              if (files === undefined || images.length === 0) return false;
              event.preventDefault();
              const at = target.posAtCoords({ x: event.clientX, y: event.clientY });
              void attach(target, images, at ?? target.state.selection.main.head);
              return true;
            },
          }),
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

  return (
    <ScrollArea className={className}>
      <div ref={host} className="flex min-w-0 flex-1 flex-col" />
    </ScrollArea>
  );
}
