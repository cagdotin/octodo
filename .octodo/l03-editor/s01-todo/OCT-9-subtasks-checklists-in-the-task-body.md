---
id: OCT-9
title: "Task body editor: CodeMirror 6 live preview with clickable checklists"
priority: none
tags: []
created: 2026-10-25T17:37:47.971Z
updated: 2026-10-26T13:23:34.220Z
order: a1
---

Replace the react-markdown preview and textarea toggle in `task-detail.tsx` with one CodeMirror 6 editor that you can edit right away. Markup is styled and hidden while the cursor is away (Obsidian Live Preview, which is CM6 as well).

- **Fidelity is the requirement.** An unchanged body saves byte for byte, and an edit changes only the bytes the user typed. CM6 holds the file text as the document, and live preview is only decorations, so this follows from the design. Test it anyway.
- **Live preview.** Read the lezer markdown tree (`syntaxTree`). Use `Decoration.mark` and `Decoration.line` for styling, and `Decoration.replace` on mark nodes unless the selection touches that line. Decorations that change height come from a StateField. The reference code is `@atomic-editor/editor`'s `inline-preview.ts` and SilverBullet's `hide_mark.ts`.
- **Checklists.** Replace `TaskMarker` with a checkbox widget. A click dispatches a one-character change (`[ ]` to `[x]`). Show progress ("2/5") on rows and cards.
- **Later, with OCT-27.** `[[OCT-3-...]]` renders as a chip with the task title (a replace widget plus `atomicRanges`), with autocomplete on `[[`.

Depends on: the CM6 prototype task in this list, which decides between forking atomic-editor and writing our own.
