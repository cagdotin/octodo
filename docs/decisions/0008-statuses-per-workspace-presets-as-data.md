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
- `config.json` holds the statuses. A status that only tasks use (a hand edit, a copied task) is
  shown as unstarted and reported as `unknown-status`, and it joins `config.json` only through
  that diagnostic's `add-status` fix. Reordering takes the order of every status shown and writes
  only the configured ones (OCT-50). Refusing to reorder while an unknown status exists was the
  other option; it would block the settings page over a problem it does not touch.

## Consequences

- Changing a preset later does not change existing workspaces.
- Presets need no code. They are JSON in the plugins or engine package.
- Dragging an unknown status in the settings page does not keep its place: it shows at the end of
  the unstarted statuses until it is added.
