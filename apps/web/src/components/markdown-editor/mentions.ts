import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { findMentions } from "@octodo/contract/rules";

/** A task a body can mention, as its chip and the `[[` completions show it. */
export interface MentionTarget {
  readonly id: string;
  readonly title: string;
  readonly closed: boolean;
  /** The task whose body is being edited: it gets a chip but is never offered. */
  readonly own: boolean;
}

/** Replaces the tasks mentions resolve to, such as after the snapshot changes. */
export const setMentionTargets = StateEffect.define<ReadonlyMap<string, MentionTarget>>();

const targetsField = StateField.define<ReadonlyMap<string, MentionTarget>>({
  create: () => new Map(),
  update: (targets, tr) =>
    tr.effects.reduce(
      (value, effect) => (effect.is(setMentionTargets) ? effect.value : value),
      targets,
    ),
});

/** What a click on a mention chip does with the task id. */
export const openMention = Facet.define<(id: string) => void, (id: string) => void>({
  combine: (values) => values[0] ?? (() => {}),
});

class MentionWidget extends WidgetType {
  readonly id: string;
  readonly target: MentionTarget | undefined;

  constructor(id: string, target: MentionTarget | undefined) {
    super();
    this.id = id;
    this.target = target;
  }

  override eq(other: MentionWidget) {
    return (
      other.id === this.id &&
      other.target?.title === this.target?.title &&
      other.target?.closed === this.target?.closed
    );
  }

  override toDOM(view: EditorView) {
    const chip = document.createElement("span");
    chip.className = "cm-md-mention";
    chip.dataset["mention"] = this.id;
    if (this.target === undefined) {
      chip.dataset["missing"] = "";
      chip.title = `No task ${this.id}`;
    } else if (this.target.closed) chip.dataset["closed"] = "";
    const id = chip.appendChild(document.createElement("span"));
    id.className = "cm-md-mention-id";
    id.textContent = this.id;
    if (this.target !== undefined) chip.append(` ${this.target.title}`);
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      if (this.target !== undefined) view.state.facet(openMention)(this.id);
    });
    return chip;
  }

  override ignoreEvent() {
    return true;
  }
}

/** A chip over every `[[HM-3]]` outside code, whatever the selection, so it moves as one unit. */
export const mentionDecorations = (state: EditorState): DecorationSet => {
  const targets = state.field(targetsField);
  return Decoration.set(
    findMentions(state.doc.toString()).map((mention) =>
      Decoration.replace({ widget: new MentionWidget(mention.id, targets.get(mention.id)) }).range(
        mention.from,
        mention.to,
      ),
    ),
  );
};

const mentionField = StateField.define<DecorationSet>({
  create: mentionDecorations,
  update: (decorations, tr) =>
    tr.docChanged || tr.effects.some((effect) => effect.is(setMentionTargets))
      ? mentionDecorations(tr.state)
      : decorations.map(tr.changes),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/** Replaces a typed `[[query` (and a `]]` right after it) with `[[id]]`, the cursor after it. */
export const completeMention = (
  state: EditorState,
  typed: { readonly from: number; readonly to: number },
  id: string,
): TransactionSpec => {
  const insert = `[[${id}]]`;
  const closing = state.sliceDoc(typed.to, typed.to + 2) === "]]" ? 2 : 0;
  return {
    changes: { from: typed.from, to: typed.to + closing, insert },
    selection: { anchor: typed.from + insert.length },
    userEvent: "input.complete",
  };
};

const OPEN_MENTION = /\[\[[^[\]\n]*$/;

/** Syntax nodes whose text is code or a comment, where `[[` is no mention. */
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "Comment", "CommentBlock"]);

const inCode = (state: EditorState, pos: number) => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (CODE.has(node.name)) return true;
  return false;
};

/**
 * Completes `[[` outside code with the other tasks whose id or title matches what follows,
 * inserting `[[HM-3]]`.
 */
export const mentionCompletions = (context: CompletionContext): CompletionResult | null => {
  const typed = context.matchBefore(OPEN_MENTION);
  if (typed === null || inCode(context.state, context.pos)) return null;
  const targets = [...context.state.field(targetsField).values()].filter((target) => !target.own);
  if (targets.length === 0) return null;
  const start = typed.from;
  return {
    from: start + 2,
    validFor: /^[^[\]\n]*$/,
    options: targets.map((target): Completion => ({
      label: `${target.id} ${target.title}`,
      type: target.closed ? "closed" : "task",
      apply: (view, _completion, _from, to) =>
        view.dispatch(completeMention(view.state, { from: start, to }, target.id)),
    })),
  };
};

export const mentions: Extension = [
  targetsField,
  mentionField,
  autocompletion({ override: [mentionCompletions], icons: false }),
];
