---
id: OCT-42
title: Task relations follow-ups from review
status: backlog
created: 2026-10-27T14:27:18.938Z
order: aL
---

Small items left after OCT-27/28/29/41 and OCT-40. None loses data.

- A symlinked `task.md` (not a folder) is still read through the link. Symlinked folders are reported and never followed.
- Task detail's due tooltip parses a due date-time in full; the rest of the web uses the date part. Left alone because of uncommitted edits in `task-detail.tsx`.
- Body mentions such as `[[MY_K-1]]` don't resolve while config.json holds a key outside `[A-Za-z][A-Za-z0-9]*` (the invalid-config diagnostic says so).
- Attachments: no HTTP Range support (video seeking in Safari), and Content-Length can mismatch when a file is replaced mid-stream.
- Two editor tests read a private widget field (`widget.url`); a behaviour test needs a DOM test dependency.
- The CLI has no test setup; its new flags (`--parent`, `--blocked-by`, `doctor --apply`) were verified by running only.
- None of this was run in the desktop (Electron) app.
