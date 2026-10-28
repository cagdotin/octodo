# 0008. Statuses belong to the workspace, and presets are data

- Status: accepted
- Date: 2026-10-28

## Context

Different workspaces want different workflows: a Linear-style project (backlog to canceled) or a
checklist (todo, done) for groceries and chores. Statuses per list would need a rule for what a
task's status becomes when it moves between lists with different status sets.

## Decision

- Statuses stay per workspace, in `config.json`. No per-list statuses.
- A preset is a named template: a statuses block, the plugins it enables, and optional starter
  lists. The first presets are Checklist (todo, done), Project (backlog through canceled) and
  Chores (a checklist with recurring tasks enabled).
- A preset is copied into `config.json` when a workspace is created, not referenced. Every
  workspace stays self-contained.

## Consequences

- Changing a preset later does not change existing workspaces.
- Presets need no code. They are JSON in the plugins or engine package.
