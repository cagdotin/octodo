---
id: OCT-94
title: "Discovery: list settings (icon, colour, per-list display options)"
status: backlog
priority: low
tags:
  - discovery
  - lists
created: 2026-10-29T13:42:12.784Z
order: a8
---

## Not decided

Do not build this yet. Discuss first: what a list's settings are, where they live on disk, and which of them a list may override from the workspace.

## What came up

While adding rename and delete for lists (decision 0028), comparing with TickTick's Add List dialog and sidebar raised these options for a list:

- **Icon.** An emoji or icon in place of the folder glyph in the sidebar.
- **Colour.** A colour per list, shown as a dot in the sidebar row.
- **Display options per list.** Today the view (list or board), grouping, sorting and which statuses show (backlog, completed, archived) are set for the whole app or workspace. TickTick lets each list keep its own. Decide which display options a list can override, and what the workspace default is.
- **List settings as a place.** Whether these live in the New list dialog (as TickTick's does: name, colour, view type, folder, list type, show in smart list), in a settings panel per list, or both.

## Questions to settle

- Storage: `list.md` frontmatter keys (`icon`, `color`, `view`, ...) fit the on-disk model, since a list's attributes already live there. Per-list display options might instead be per-browser preferences. Which are shared through the files and which are personal?
- Which smart views a list appears in ("Show in Smart List" in TickTick).
- How the dialog previews the result.
