---
id: OCT-64
title: "Automations: run a command when something happens in a workspace"
status: backlog
priority: low
tags:
  - idea
  - plugins
  - automations
created: 2026-10-28T07:40:53.898Z
order: a5
---

## Why we might want this

Automations are the one place where letting outside code in pays off, without risking the files. Examples:

- When a task moves to Done, post it to a chat channel or append it to a daily note.
- When a task tagged `deploy` is created, open a GitHub issue.
- Archive tasks that have been done for 14 days (the old auto-archive idea).
- Every morning, move overdue chores to Today (needs a running server; see [[OCT-62]]).
- When an agent finishes a task over MCP, notify me on the phone.

Each one is personal and different, so building them into octodo does not scale. A hook model lets a script in any language do it.

## The recommended design (from the 2026-10-28 survey, so the research need not be rerun)

Copy herdr's plugin model (`src/app/api/plugins/runtime.rs`, `docs/next/website/src/content/docs/plugins.mdx` in github.com/herdrdev/herdr):

- **A hook is a command line run on an event.** It runs as its own child process, in any language. It cannot corrupt a read or crash the server.
- **Context goes in environment variables:** e.g. `OCTODO_EVENT=task.completed`, `OCTODO_EVENT_JSON` (the event and the task as JSON), `OCTODO_WORKSPACE`, `OCTODO_TASK_ID`, and `OCTODO_BIN` (the `octo` CLI path), so the hook can act back through the CLI. "The CLI is the plugin API": no SDK to maintain.
- **A closed list of events.** herdr allows 22 (workspace, pane, agent status). For octodo: `task.created`, `task.updated`, `task.moved` (status or list), `task.completed`, `task.deleted`, `list.created`, and scheduled ticks if a server runs.
- **Limits:** herdr caps output at 64 KiB, runs at most 32 commands at once and keeps the last 200 run logs in memory. Show recent runs and failures in the app.
- **Declared where?** In the workspace `config.json` (`hooks: [{ on, run }]`) or a file under `<home>`. Never auto-run code that arrives inside a synced `.octodo/` without the user approving it once (pi's project-trust model, `docs/security.md` in earendil-works/pi).

## Why not in-process plugins for this

pi, bb and opencode load plugin code into the host process with full trust. bb needs a `safe-mode` switch because one bad plugin takes the server down. For a personal task app, a process boundary is safer and language-agnostic, and the cost (a process spawn per event) is irrelevant at human event rates.

## Prerequisites

- The operation catalog ([[OCT-52]]), so hooks can call every operation through `octo`.
- The server-preferred topology ([[OCT-54]]), so events come from one place.
- Change events that carry task ids ([[OCT-17]]).

## Open questions

- Hooks on the CLI's embedded mode too, or only while a server runs?
- Synchronous "before" hooks that can veto a change? herdr has none; start with "after" only.
