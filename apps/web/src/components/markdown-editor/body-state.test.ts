import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyExtensions, syncToFile } from "./body-state.ts";
import { imageUrl, previewDecorations, setFocused, toggleTask } from "./live-preview.ts";

const BODY = [
  "# Garden plan",
  "",
  'Some *emphasis*, **strong**, `code`, ~~gone~~ and a [link](https://example.com "title").',
  "Bare https://octodo.dev and <https://auto.link> and an escaped \\* star.",
  "",
  "- [ ] dig beds  ",
  "- [x] buy seeds",
  "  - [X] tomatoes\t",
  "  - [ ] basil",
  "1. ordered",
  "   * nested bullet",
  "",
  "> quoted *text*",
  "> - [ ] quoted task",
  "",
  "| Bed | Crop |",
  "| :-- | ---: |",
  "| 1   | kale |",
  "",
  "```ts",
  "const x = 1; // - [ ] not a task",
  "```",
  "",
  "<details><summary>HTML</summary>kept as is</details>",
  "",
  "Setext",
  "===",
  "",
  "***",
  "![floor plan](images/floor%20plan.png) and ![](<images/a b.png>)",
  "emoji ✅ and combining é and astral 𝄞",
].join("\n");

const resolve = (src: string) => (src.startsWith("javascript:") ? null : `/files/${src}`);

const create = (doc: string) =>
  EditorState.create({ doc, extensions: [bodyExtensions, imageUrl.of(resolve)] });

/** Builds the preview with the editor focused and the cursor at `head`. */
const focusedAt = (doc: string, head: number) => {
  return create(doc).update({
    selection: EditorSelection.cursor(head),
    effects: setFocused.of(true),
  }).state;
};

const taskMarkers = (state: EditorState) => {
  const found: Array<number> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "TaskMarker") found.push(node.from);
    },
  });
  return found;
};

const changedIndexes = (before: string, after: string) => {
  const indexes = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) indexes.push(i);
  }
  return indexes;
};

describe("body round-trip", () => {
  const variants = {
    "LF with a trailing newline": `${BODY}\n`,
    "no trailing newline": BODY,
    CRLF: BODY.replaceAll("\n", "\r\n"),
    "lone CR and mixed endings": "a\rb\r\nc\nd",
    "blank lines only": "\n\n\n",
    empty: "",
  };

  for (const [label, body] of Object.entries(variants)) {
    it(`keeps an unchanged body byte for byte (${label})`, () => {
      const state = create(body);
      previewDecorations(state);
      previewDecorations(focusedAt(body, Math.floor(body.length / 2)));
      expect(state.doc.toString()).toBe(body);
      expect(state.doc.length).toBe(body.length);
    });
  }

  it("changes only the typed bytes on an edit", () => {
    const body = BODY.replaceAll("\n", "\r\n");
    const at = body.indexOf("dig beds") + "dig".length;
    const after = create(body).update({
      changes: { from: at, insert: " raised" },
      userEvent: "input.type",
    }).state;
    expect(after.doc.toString()).toBe(`${body.slice(0, at)} raised${body.slice(at)}`);
  });

  it("continues a checklist on Enter with exactly the new item's markup", () => {
    const body = "- [x] first";
    let state = create(body).update({ selection: EditorSelection.cursor(body.length) }).state;
    insertNewlineContinueMarkup({
      state,
      dispatch: (tr: Transaction) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("- [x] first\n- [ ] ");
  });
});

describe("checkbox toggle", () => {
  it("flips each task marker with a single-character change and back again", () => {
    const state = create(BODY);
    const markers = taskMarkers(state);
    expect(markers).toHaveLength(5);
    for (const marker of markers) {
      const toggled = state.update(toggleTask(state, marker)!).state;
      const after = toggled.doc.toString();
      expect(changedIndexes(BODY, after), "one byte, inside the brackets").toEqual([marker + 1]);
      expect(after[marker + 1]).toBe(BODY[marker + 1] === " " ? "x" : " ");
      const back = toggled.update(toggleTask(toggled, marker)!).state.doc.toString();
      expect(changedIndexes(after, back)).toEqual([marker + 1]);
    }
  });

  it("does nothing where there is no task marker", () => {
    expect(toggleTask(create(BODY), 0)).toBeNull();
  });
});

describe("syncToFile", () => {
  it("rewrites only the span that differs and leaves history alone", () => {
    const state = create(BODY);
    const next = BODY.replace("buy seeds", "buy more seeds");
    const spec = syncToFile(state, next)!;
    const tr = state.update(spec);
    expect(tr.state.doc.toString()).toBe(next);
    const touched: Array<[number, number]> = [];
    tr.changes.iterChangedRanges((from, to) => touched.push([from, to]));
    expect(touched).toEqual([[BODY.indexOf("seeds"), BODY.indexOf("seeds")]]);
    expect(syncToFile(tr.state, next)).toBeNull();
  });
});

const replacedRanges = (state: EditorState) => {
  const ranges: Array<[number, number]> = [];
  previewDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
    if (decoration.point) ranges.push([from, to]);
  });
  return ranges;
};

describe("live preview", () => {
  it("hides heading markup until the cursor is on its line in a focused editor", () => {
    const doc = "# Title\n\nbody";
    expect(replacedRanges(create(doc))).toContainEqual([0, 2]);
    expect(replacedRanges(focusedAt(doc, doc.length))).toContainEqual([0, 2]);
    expect(replacedRanges(focusedAt(doc, 3))).not.toContainEqual([0, 2]);
  });

  it("draws a checkbox over every task marker, even on the cursor's line", () => {
    const state = focusedAt(BODY, BODY.indexOf("dig beds"));
    const checkboxes: Array<[number, number]> = [];
    previewDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
      if (decoration.spec.widget?.constructor.name === "CheckboxWidget")
        checkboxes.push([from, to]);
    });
    expect(checkboxes).toEqual(taskMarkers(state).map((marker) => [marker, marker + 3]));
  });
});

const images = (state: EditorState) => {
  const found: Array<{ from: number; to: number; url: string }> = [];
  previewDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
    const widget: unknown = decoration.spec.widget;
    if (widget !== null && typeof widget === "object" && "url" in widget)
      found.push({ from, to, url: String(widget.url) });
  });
  return found;
};

describe("images", () => {
  it("draws an image over its markdown with the URL the editor resolves it to", () => {
    const doc = "see ![plan](images/plan.png) here";
    expect(images(create(doc))).toEqual([
      { from: 4, to: doc.indexOf(" here"), url: "/files/images/plan.png" },
    ]);
  });

  it("shows the source while the cursor is on its line, and when the src is refused", () => {
    expect(images(focusedAt("![plan](images/plan.png)", 3))).toEqual([]);
    expect(images(create("![x](javascript:alert(1))"))).toEqual([]);
  });

  it("leaves images as source without a resolver", () => {
    const state = EditorState.create({
      doc: "![plan](images/plan.png)",
      extensions: bodyExtensions,
    });
    expect(images(state)).toEqual([]);
  });
});
