---
id: OCT-13
title: Rename task folder when its title changes
created: 2026-10-25T17:45:01.676Z
order: a3
status: done
---

Done as part of OCT-40: a title change writes `task.md`, then renames the task folder to `<id>-<slug>`.

Links (OCT-27) hold bare ids, so a rename never has to rewrite other files. A crash between the write and the rename leaves a stale folder name, which is harmless because the scanner reads no meaning from folder names. The next rename fixes it.

Close this when OCT-40 lands.
