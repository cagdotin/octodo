import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

/** The editor gained (true) or lost (false) focus. */
export const setFocused = StateEffect.define<boolean>();

const focusedField = StateField.define<boolean>({
  create: () => false,
  update: (focused, tr) =>
    tr.effects.reduce((value, effect) => (effect.is(setFocused) ? effect.value : value), focused),
  provide: () => EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
});

/** Markup shows as source on the lines the selection touches while the editor has focus. */
export const isRevealed = (state: EditorState, from: number, to: number): boolean => {
  if (!state.field(focusedField)) return false;
  const start = state.doc.lineAt(from).from;
  const end = state.doc.lineAt(to).to;
  return state.selection.ranges.some((range) => range.from <= end && range.to >= start);
};

/** The one-character change that flips the task marker starting at `pos`, or `null`. */
export const toggleTask = (state: EditorState, pos: number): TransactionSpec | null => {
  const marker = state.sliceDoc(pos, pos + 3);
  const next = marker === "[ ]" ? "x" : marker === "[x]" || marker === "[X]" ? " " : null;
  if (next === null) return null;
  return { changes: { from: pos + 1, to: pos + 2, insert: next }, userEvent: "input.toggle" };
};

/** Toggles the task on the cursor's line (Mod-Enter). */
export const toggleTaskOnLine = (view: EditorView): boolean => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  let marker: number | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === "TaskMarker" && marker === null) marker = node.from;
    },
  });
  const spec = marker === null ? null : toggleTask(state, marker);
  if (spec === null) return false;
  view.dispatch(spec);
  return true;
};

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;

  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  override toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-md-checkbox";
    input.setAttribute("aria-label", this.checked ? "Mark as not done" : "Mark as done");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      const spec = toggleTask(view.state, view.posAtDOM(input));
      if (spec !== null) view.dispatch(spec);
    });
    return input;
  }

  override ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }

  override toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-md-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

const BULLET = new BulletWidget();

type TableRows = ReadonlyArray<ReadonlyArray<string>>;

class TableWidget extends WidgetType {
  readonly rows: TableRows;

  constructor(rows: TableRows) {
    super();
    this.rows = rows;
  }

  override eq(other: TableWidget) {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }

  override toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const table = wrap.appendChild(document.createElement("table"));
    this.rows.forEach((cells, index) => {
      const row = table.appendChild(document.createElement("tr"));
      for (const text of cells) {
        row.appendChild(document.createElement(index === 0 ? "th" : "td")).textContent = text;
      }
    });
    return wrap;
  }
}

const tableRows = (state: EditorState, table: SyntaxNode): TableRows =>
  [...table.getChildren("TableHeader"), ...table.getChildren("TableRow")].map((row) =>
    row.getChildren("TableCell").map((cell) => state.sliceDoc(cell.from, cell.to).trim()),
  );

const HEADING_LEVEL: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

const INLINE_CLASS: Readonly<Record<string, string>> = {
  Emphasis: "cm-md-em",
  StrongEmphasis: "cm-md-strong",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-inline-code",
  Link: "cm-md-link",
  HTMLTag: "cm-md-html",
  HTMLBlock: "cm-md-html",
  CommentBlock: "cm-md-html",
};

/** Marks hidden on lines the selection is away from. */
const HIDDEN_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "HeaderMark", "QuoteMark"]);

const LINK_SCHEMES = /^(https?:|mailto:)/i;

/** The address a click on a link at `pos` opens: http(s) and mailto only. */
export const linkAt = (state: EditorState, pos: number): string | null => {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node;) {
    if (node.name === "URL" || node.name === "Link" || node.name === "Autolink") {
      const url = node.name === "URL" ? node : node.getChild("URL");
      if (url === null) return null;
      const href = state.sliceDoc(url.from, url.to);
      if (LINK_SCHEMES.test(href)) return href;
      return /^www\./i.test(href) ? `https://${href}` : null;
    }
    node = node.parent;
  }
  return null;
};

/** How many list items enclose the item that owns this list mark. */
const listNesting = (mark: SyntaxNode): number => {
  let nesting = 0;
  for (let parent = mark.parent?.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem") nesting += 1;
  }
  return nesting;
};

const linesOf = (state: EditorState, from: number, to: number) => {
  const lines = [];
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    lines.push(state.doc.line(n));
  }
  return lines;
};

/** Live preview: style the markdown tree and hide its markup away from the selection. */
export const previewDecorations = (state: EditorState): DecorationSet => {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const out: Array<Range<Decoration>> = [];
  const line = (from: number, cls: string) => out.push(Decoration.line({ class: cls }).range(from));
  const hide = (from: number, to: number) => {
    if (from < to) out.push(Decoration.replace({}).range(from, to));
  };
  const hideWithSpace = (from: number, to: number) => {
    const end = state.doc.lineAt(from).to;
    let stop = to;
    while (stop < end && state.sliceDoc(stop, stop + 1) === " ") stop++;
    hide(from, stop);
  };

  const enter = (node: SyntaxNodeRef): boolean | void => {
    const { name, from, to } = node;
    const revealed = isRevealed(state, from, to);

    const level = HEADING_LEVEL[name];
    if (level !== undefined) {
      for (const each of linesOf(state, from, to)) line(each.from, `cm-md-h cm-md-h${level}`);
    }
    const inline = INLINE_CLASS[name];
    if (inline !== undefined && from < to) {
      out.push(Decoration.mark({ class: inline }).range(from, to));
    }
    if (HIDDEN_MARKS.has(name) && !revealed) {
      if (name === "HeaderMark" || name === "QuoteMark") hideWithSpace(from, to);
      else hide(from, to);
    }

    switch (name) {
      case "Blockquote":
        for (const each of linesOf(state, from, to)) line(each.from, "cm-md-quote");
        return;
      case "FencedCode": {
        const lines = linesOf(state, from, to);
        lines.forEach((each, index) => {
          const edge =
            (index === 0 ? " cm-md-code-first" : "") +
            (index === lines.length - 1 ? " cm-md-code-last" : "");
          line(each.from, `cm-md-code${edge}`);
        });
        if (!revealed) {
          for (const mark of [
            ...node.node.getChildren("CodeMark"),
            ...node.node.getChildren("CodeInfo"),
          ]) {
            hide(mark.from, mark.to);
          }
        }
        return false;
      }
      case "CodeMark":
        if (!revealed) hide(from, to);
        return;
      case "Link": {
        if (revealed) return;
        const marks = node.node.getChildren("LinkMark");
        const close = marks.find((mark) => state.sliceDoc(mark.from, mark.to) === "]");
        const opener = marks[0];
        if (opener === undefined || close === undefined || close.to === to) return;
        hide(opener.from, opener.to);
        hide(close.from, to);
        return;
      }
      case "URL":
        if (node.node.parent?.name !== "Link") {
          out.push(Decoration.mark({ class: "cm-md-link" }).range(from, to));
        }
        return;
      case "Escape":
        if (!revealed) hide(from, from + 1);
        return;
      case "HorizontalRule":
        if (!revealed) {
          line(state.doc.lineAt(from).from, "cm-md-hr");
          hide(from, to);
        }
        return;
      case "ListMark": {
        const markLine = state.doc.lineAt(from);
        const nesting = listNesting(node.node);
        if (nesting > 0 && /^\s+$/.test(state.sliceDoc(markLine.from, from))) {
          out.push(
            Decoration.line({
              attributes: { style: `padding-left: calc(0.5rem + ${nesting * 1.25}em)` },
            }).range(markLine.from),
          );
          hide(markLine.from, from);
        }
        const task = node.node.nextSibling?.firstChild;
        const isTask = task?.name === "TaskMarker";
        if (revealed) {
          out.push(Decoration.mark({ class: "cm-md-list-mark" }).range(from, to));
        } else if (isTask) {
          hide(from, task.from);
        } else if (/^[-*+]$/.test(state.sliceDoc(from, to))) {
          out.push(Decoration.replace({ widget: BULLET }).range(from, to));
        } else {
          out.push(Decoration.mark({ class: "cm-md-list-mark" }).range(from, to));
        }
        return;
      }
      case "TaskMarker": {
        const checked = state.sliceDoc(from, to) !== "[ ]";
        out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
        const taskNode = node.node.parent;
        const text = state.sliceDoc(to, taskNode?.to ?? to);
        const start = to + text.length - text.trimStart().length;
        if (checked && taskNode !== null && start < taskNode.to) {
          out.push(Decoration.mark({ class: "cm-md-done" }).range(start, taskNode.to));
        }
        return;
      }
      case "Table":
        if (revealed) {
          for (const each of linesOf(state, from, to)) line(each.from, "cm-md-table-source");
          return;
        }
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableRows(state, node.node)),
            block: true,
          }).range(state.doc.lineAt(from).from, state.doc.lineAt(to).to),
        );
        return false;
      default:
        return;
    }
  };

  tree.iterate({ enter });
  return Decoration.set(out, true);
};

const previewField = StateField.define<DecorationSet>({
  create: previewDecorations,
  update: (decorations, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((effect) => effect.is(setFocused)) ||
    syntaxTree(tr.startState) !== syntaxTree(tr.state)
      ? previewDecorations(tr.state)
      : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

/** Opens rendered links on click, and any link on Cmd/Ctrl-click, instead of placing the cursor. */
const openLinks = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const target = event.target.closest(".cm-md-link");
    if (target === null) return false;
    const pos = view.posAtDOM(target);
    const href = linkAt(view.state, pos);
    if (href === null) return false;
    if (!(event.metaKey || event.ctrlKey) && isRevealed(view.state, pos, pos)) return false;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  },
});

export const livePreview: Extension = [focusedField, previewField, openLinks];
