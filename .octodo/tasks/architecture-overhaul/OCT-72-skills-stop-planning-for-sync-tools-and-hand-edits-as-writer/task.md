---
id: OCT-72
title: Skills stop planning for sync tools and hand edits as writers
status: done
priority: medium
tags:
  - agents
  - docs
created: 2026-10-28T10:12:20.266Z
order: aO
---

## Goal

Decisions 0001 and 0010: octodo's own clients are the only supported writers of `.octodo/`, and octodo runs locally on one computer. Several skills under `.agents/skills` still tell agents to plan for sync tools, hand edits and people as concurrent writers, or for remote access, so agents keep re-adding that handling.

## Scope

Found by grep (`sync tool|hand edit|icloud|dropbox|syncthing`): `octo-mode/SKILL.md` (principle Separate Before Serializing Shared State's description, "Verify on the real surface" hand-edit bullet), `octo-mode/playbooks/bug-fix.md`, `octo-mode/playbooks/refactoring.md`, `interrogate/references/rubric.md`, `comment-review/SKILL.md`, `create-formal-verification-skill/SKILL.md`, `create-verification-skill/SKILL.md`, `improve-codebase-architecture/references/vocabulary.md`, `why/references/synthesizer-prompt.md`. Check the principle leaf skills too.

Rewrite each mention to the current contract: other writers are outside the contract and show up as diagnostics; concurrency that matters is between octodo's own processes, serialized by the owner lock (0003). Keep generic advice that isn't about octodo.

## Done when

- The grep finds only text that matches the contract.
- `pnpm check` passes.
