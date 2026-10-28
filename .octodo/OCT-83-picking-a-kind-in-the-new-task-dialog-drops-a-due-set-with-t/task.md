---
id: OCT-83
title: Picking a kind in the new-task dialog drops a due set with the Due chip
status: todo
priority: low
created: 2026-10-28T14:32:54.675Z
order: aO
---

Found while fixing the review findings (OCT-61). A due typed in the title now stays in the title as text when a kind is picked, as decision 0023 records. A due set with the Due chip has no text to fall back to, so it is dropped silently.

Options: say so in the dialog, or seed the kind's own date slot (Recurring's first due, an anniversary's date) from it. Seeding needs each kind to say which of its keys takes a date, which goes with 0023's "a kind owns the date slot".
