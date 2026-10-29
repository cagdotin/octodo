---
id: OCT-93
title: "Counters: attachments, search and ⌘K inside a section"
status: todo
priority: low
tags:
  - plugins
  - web
created: 2026-10-28T17:11:08.614Z
order: a3
---

Left open by OCT-90 ([0027](docs/decisions/0027-plugins-add-sections-tasks-is-the-built-in-one.md)):

- A counter's panel shows no attachments, and an image cannot be pasted into its body. The file operations (`upload_attachment`, `read_attachment`, the download route) take only task ids, so they need to learn entries. Decide whether they take any entry's id or whether each section gets its own operations.
- ⌘K and the sidebar's search do nothing inside a section.
- The app cannot reset a since counter at an earlier time; the CLI's `--at` can.
- No component tests cover the Counters view. It was checked only in the browser.
