---
id: OCT-30
title: "Prototype: CodeMirror 6 on iPhone and atomic-editor in task detail"
priority: none
tags:
  - web
  - prototype
created: 2026-10-26T13:23:28.325Z
updated: 2026-10-26T13:23:28.325Z
order: a0
---

Throwaway prototypes to settle the editor choice before OCT-9 and the composer. The research recommends CodeMirror 6 for both the body and quick add. It's the only engine tested whose unedited round-trip was byte-identical. Lexical, TipTap, Milkdown and remark all rewrote a 33-line sample with no edit. The outputs are in the session scratchpad.

1. **The composer on iPhone.** A single-line CM6 input with one atomic chip widget, next to a plain `<input>` with a highlight overlay (Super Productivity's approach). Test over Tailscale with autocorrect, dictation and Japanese kana. There's an open CM6 report (June 2026) of Safari IME breaking next to widgets: https://discuss.codemirror.net/t/ime-input-may-break-when-cursor-is-adjacent-to-widget-due-to-cm-widgetbuffer-reconstruction/9799. This prototype decides the composer engine.
2. **The body in task detail.** Mount `@atomic-editor/editor` (MIT, CM6, one author, 0.6.2) on a scratch workspace. Toggle a checkbox and assert that the file diff is exactly one byte. Judge how revealing markup at the cursor feels on desktop and phone. This decides between forking or vendoring atomic-editor and writing our own live preview (its `inline-preview.ts` is about 1.1K lines).

Also measure the bundle cost. CM6 is about 114K gzip, or about 186K with `@codemirror/lang-markdown` (measured with esbuild). atomic-editor wasn't measured.
