# tasksmd

Local-first task manager where every task is a markdown file. Works like Obsidian vaults: point it
at a project folder and it manages `<project>/.tasks/`.

```
house-move/.tasks/
├── config.json              # { "name": "House Move", "key": "CT", "statuses": [...] }
├── s-backlog/
├── s-todo/
│   └── CT-12-reconcile-kraken-trades.md
├── s-in-progress/
├── s-done/
└── c-research/              # a list (c- category, p- project)
    └── s-todo/
        └── CT-14-read-bmf-guidance.md
```

```markdown
---
id: CT-12
title: Reconcile Kraken trades
priority: high
tags: [exchange]
due: 2026-11-02
created: 2026-10-25T17:30:47.592Z
updated: 2026-10-25T17:30:47.600Z
order: a0
---

Notes in markdown.
```

## Use it

```sh
mise run setup                       # Node 26 + pnpm 12 + dependencies
bin/tasksmd init ~/code/my-project   # create .tasks/ and register the workspace
cd ~/code/my-project
tasksmd create "First task" -p high -t setup
tasksmd list
tasksmd move MP-1 in-progress
tasksmd skills export                # teach this project's agents about tasksmd
tasksmd serve                        # web app + API + MCP on http://127.0.0.1:4520
```

Run `bin/tasksmd` from the repository, or link it onto your PATH (`ln -s "$PWD/bin/tasksmd" ~/.local/bin/`).

### Agents (MCP)

Over stdio, for agents that launch it themselves (Claude Code shown):

```sh
claude mcp add tasksmd -- /path/to/tasksmd/bin/tasksmd mcp
```

Over HTTP while the app or `tasksmd serve` runs: `http://127.0.0.1:4520/mcp` with
`Authorization: Bearer <token>`, where the token is in `~/.config/tasksmd/server.json`.

### From your phone

`tasksmd serve --host <tailscale-ip>` (add `--allow-host <name>.ts.net` to use the MagicDNS name).
Open the URL on the phone and paste the token once, or open the pairing link.

## Develop

```sh
pnpm dev            # desktop app (Electron + Vite)
pnpm dev:web        # API + Vite, use it in the browser
pnpm check          # format, lint, typecheck, tests
```

See [AGENTS.md](AGENTS.md) for the architecture and conventions.
