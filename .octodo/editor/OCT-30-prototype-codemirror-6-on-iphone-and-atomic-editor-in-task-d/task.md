---
id: OCT-30
title: "Prototype: settle the CodeMirror 6 editor choice (desktop)"
tags:
  - web
  - prototype
created: 2026-10-26T13:23:28.325Z
order: a2
status: done
---

Settle the editor choice. The research recommends CodeMirror 6 for both the body and quick add. It's the only engine tested whose unedited round-trip was byte-identical. Lexical, TipTap, Milkdown and remark all rewrote a 33-line sample with no edit.

Scope is desktop only (decided 2026-10-26). Phone, iOS and IME behavior are out of scope until real use turns up problems, which will get their own tasks.

- **Body.** Evaluate `@atomic-editor/editor` (MIT, CM6, one author, 0.6.2) against writing our own live preview, and decide between depending on it, vendoring it, or writing our own. The OCT-9 work does this.
- **Quick add.** CM6 single-line. The OCT-31 work does this.
- **Bundle cost.** Measure it. CM6 is about 114K gzip, or about 186K with `@codemirror/lang-markdown` (measured with esbuild).
