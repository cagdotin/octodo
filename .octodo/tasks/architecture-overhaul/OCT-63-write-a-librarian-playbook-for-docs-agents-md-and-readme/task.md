---
id: OCT-63
title: Write a librarian playbook for docs, AGENTS.md and README
status: done
priority: medium
tags:
  - agents
  - docs
created: 2026-10-28T07:40:39.401Z
order: aJ
---

## Goal

Agents keep `docs/`, `AGENTS.md` and `README.md` true as the code changes, with no reminder needed. Decisions go to `docs/decisions/`, never to agent memory.

## Scope

- A new octo-mode playbook (`.claude/skills/octo-mode/playbooks/librarian.md`, via the authoring-a-skill playbook) with a trigger in octo-mode's `SKILL.md`. It covers:
  - when to write a decision record and its format (see `docs/decisions/README.md`)
  - what goes in `AGENTS.md` (rules an agent must follow, kept short) versus `docs/` (the why, progressively disclosed from `docs/README.md`)
  - updating `docs/architecture.md` "Today" sections in the same commit as the code, and deleting "Target" sections once true
  - checking docs for stale claims before a merge
- Consider a check that encodes part of it (a test that every `docs/decisions/*.md` is listed in its README; links resolve).
- Decide whether to turn off Claude Code's auto-memory for this repo, and move the decisions in the existing memory files into `docs/`.

## Done when

- The playbook exists and octo-mode routes doc work to it.
