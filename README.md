<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-banner-dark.png">
  <img alt="octodo" src="docs/assets/readme-banner-light.png">
</picture>

# octodo

Local-first task manager where every task is a markdown file. Works like Obsidian vaults: point it
at a project folder and it manages `<project>/.octodo/`.

```
house-move/.octodo/
├── config.json              # { "name": "House Move", "key": "HM", "statuses": [...] }
├── HM-12-book-the-movers/    # a folder with task.md is a task
│   ├── task.md
│   ├── images/quote.png      # anything else in it is an attachment
│   └── HM-13-call-three-firms/
│       └── task.md          # a task inside a task is a subtask
└── packing/                 # a folder with list.md is a list
    ├── list.md
    ├── kitchen/             # lists nest up to three levels
    │   └── list.md
    └── HM-15-pack-the-books/
        └── task.md
```

```markdown
---
id: HM-12
title: Book the movers
status: todo
priority: high
tags: [quotes]
due: 2026-11-02
created: 2026-10-25T17:30:47.592Z
order: a0
blocked_by: [HM-9]
---

Three quotes so far. Notes in markdown.
```

## Install

Download the `.dmg` of the [latest release](https://github.com/cagdotin/octodo/releases/latest)
(Apple Silicon Macs) and drag octodo to Applications. The app is not notarized yet, so the first
time macOS says it cannot verify it: open System Settings > Privacy & Security and click Open
Anyway. After that octodo updates itself: when a new version is downloaded, an Update button
appears at the bottom of the sidebar.

Releases marked "Pre-release" are nightlies, built from every change to `master`. A nightly
updates to newer nightlies and to stable releases; a stable release updates only to stable ones.

The app ships the `octo` CLI and links it as `~/.local/bin/octo` the first time it opens (an
`octo` that already works there is left alone). Add `~/.local/bin` to your PATH if it is not on
it. `octo` updates along with the app:

```sh
octo upgrade                    # update the app (and this octo) now
octo upgrade --channel nightly  # move to the nightly channel
```

## Use it

```sh
mise run setup                       # Node 26 + pnpm 12 + gitleaks + dependencies
bin/octo init ~/code/my-project      # create .octodo/ and register the workspace
cd ~/code/my-project
octo create "First task" -p high -t setup
octo list
octo move MP-1 in-progress
octo skills export                   # teach this project's agents about octodo
octo serve                           # web app + API + MCP on http://127.0.0.1:4520
```

From a checkout, run `bin/octo`, or link it onto your PATH (`ln -s "$PWD/bin/octo" ~/.local/bin/`).

### Agents (MCP)

Over stdio, for agents that launch it themselves (Claude Code shown):

```sh
claude mcp add octodo -- /path/to/octodo/bin/octo mcp
```

Over HTTP while the app or `octo serve` runs: `http://127.0.0.1:4520/mcp`. The server answers on
this computer only and needs no credentials.

## Develop

```sh
pnpm dev            # desktop app (Electron + Vite)
pnpm dev:web        # API + Vite, use it in the browser
pnpm check          # format, lint, react doctor, typecheck, tests
```

See [AGENTS.md](AGENTS.md) for the architecture and conventions.
