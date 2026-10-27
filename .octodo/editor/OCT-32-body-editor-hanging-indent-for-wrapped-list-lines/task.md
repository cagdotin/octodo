---
id: OCT-32
title: "Body editor: hanging indent for wrapped list lines"
tags:
  - web
created: 2026-10-26T13:57:06.348Z
order: a0
status: backlog
---

In the CodeMirror body editor (`apps/web/src/components/markdown-editor/`), a list item that wraps continues at the left edge instead of lining up with the item's text. Indent the wrapped lines to match, for example with a line decoration that sets `padding-left` and a negative `text-indent` sized to the marker. Follow-up from OCT-9.
