---
id: OCT-13
title: Rename task file when its title changes
priority: none
tags: []
created: 2026-10-25T17:45:01.676Z
updated: 2026-10-26T13:03:44.045Z
order: a3
---

When a title changes, rename the file to `taskFileName(id, title)` (`packages/core/src/layout.ts`) and, in the same operation, rewrite every task link (OCT-27) that points at the old file name, in frontmatter and body alike.

- Only octodo renames task files, so this is the one place links can go stale. No separate repair pass is needed.
- The rewrite has to be idempotent: for each link, compare its text with the target's current file name and rewrite only if they differ. Rewriting several files isn't atomic as a set. After a crash, stale links still resolve by id, and running the rename again finishes the job.
- Every file write uses the existing write-temp-then-rename path.

Depends on: OCT-27.
