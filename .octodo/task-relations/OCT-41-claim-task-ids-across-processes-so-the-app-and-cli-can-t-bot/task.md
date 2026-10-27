---
id: OCT-41
title: Claim task ids across processes so the app and CLI can't both create HM-N
tags:
  - core
created: 2026-10-27T12:24:31.804Z
order: a1
status: done
---

Found in the OCT-40 core review (finding 3). New ids are max+1 over the process's own snapshot. When the CLI creates HM-1 while the app holds a cached scan, the app also creates HM-1. One copy then hides as "Duplicate task id", and writes go to the other copy. This predates OCT-40: the old layout had the same race.

- Claim the id exclusively before creating the folder (for example `open(.octodo/.ids/<id>, "wx")`), or rescan after the rename and move to the next free id if another folder holds it.
- The test opens two workspaces on one folder and creates from both.
- Keep it crash-safe: a claim left by a crashed create has to be recognizable as stale.
