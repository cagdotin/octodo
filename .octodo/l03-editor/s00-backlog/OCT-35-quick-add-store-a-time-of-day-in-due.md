---
id: OCT-35
title: "Quick add: store a time of day in due"
priority: none
tags:
  - web
  - core
created: 2026-10-26T14:14:00.104Z
updated: 2026-10-26T14:14:00.104Z
order: a3
---

The quick add parser (`apps/web/src/lib/quick-add.ts`) already reads times ("tomorrow 5pm"), but only the day is saved. `due` is a plain `YYYY-MM-DD` string, and other code compares it as one (the Today and Next 7 days views, `dueInfo`). Decide on the stored format (for example `2026-10-27T17:00`, or a separate key), then update the schema, the views and the due picker together. Follow-up from OCT-31.
