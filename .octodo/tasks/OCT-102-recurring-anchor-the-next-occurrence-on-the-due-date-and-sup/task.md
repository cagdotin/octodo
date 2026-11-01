---
id: OCT-102
title: "Recurring: anchor the next occurrence on the due date, and support yearly rules like Black Friday"
status: backlog
priority: low
tags:
  - plugins
  - recurring
created: 2026-10-30T22:55:20.375Z
order: a3
---

`octo recurring create` anchors the rule on `created`, and it has no `--due` flag. So `OV-7` (Black Friday wishlist, `every year`, due 2026-11-27) shows `next 2026-10-30` instead of 2026-11-27, and later years land on Oct 30.

Ideas:

- Use `due` as the anchor when it's set, and add `--due` or `--start` to `recurring create`.
- Support yearly calendar rules like `yearly on november 27` or `the day after the fourth thursday of november` (Black Friday), so moving dates stay right.

Filed by Grok Bot for cagin.
