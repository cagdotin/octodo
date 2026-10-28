---
id: OCT-90
title: The app's sidebar lists the enabled sections; a Counters view
status: todo
priority: high
tags:
  - web
  - plugins
created: 2026-10-28T15:52:13.172Z
order: a2
blocked_by: [OCT-89]
---

Phase 3 of [0027](docs/decisions/0027-plugins-add-sections-tasks-is-the-built-in-one.md). It needs the counters plugin from phase 2.

## Scope

- Remove the calendar placeholder from the sidebar rail.
- The rail shows Tasks first, then one icon per section the workspace enables. A plugin's web half contributes its section's icon, route and view. The counters route, and its icon, exist only while the workspace enables `counters`; a URL to it otherwise lands on Tasks.
- The Counters view is one flat list with since and yearly rows. It covers create (with a kind picker), reset, edit and delete, and each counter's page has its body and attachments.
- Today and Next 7 days show a yearly counter whose day is due as a read-only row that opens it.
- Enabling and disabling the plugin in settings shows and hides the section live.
- Remove the counter and anniversary kinds from the new-task dialog's kind picker.

## Done when

- `pnpm check` passes.
- The real app on a scratch home, driven in a browser or Electron, shows each of these, with screenshots reviewed and then deleted.
