---
name: interrogate
description: 'Use for "interrogate", "adversarial review", "challenge this", "stress test this code", "find blind spots", or "tear this apart". An independent reviewer, not anchored on the author''s reasoning, tries to break a change. You then judge every finding.'
disable-model-invocation: true
---

# Interrogate

Get an adversarial review of a change from a reader who did not write it. The adversarial signal comes from independence: a fresh context that sees the code, not the author's reasoning. The deliverable is your judged verdict. Do NOT auto-apply changes.

## Step 1. Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- On a feature branch, `git diff master...HEAD` for the full changeset, plus the working tree.
- If the user's message references recent work, gather the relevant files.

Note the surrounding files a reviewer needs to understand the code: callers, the schemas in `packages/contract/src/domain.ts`, the rules in `AGENTS.md` the change touches.

## Step 2. Intent

State the intent in one clear paragraph from the user's message, commit messages, the PR description, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3. Spawn the reviewer

Spawn one read-only reviewer subagent and tell it not to edit files. Build its prompt from `references/reviewer-prompt.md` with the intent, the diff or file paths, the rubric from `references/rubric.md`, and the lens from `references/code-quality-review.md`. Point it at files instead of pasting them when it can read the repo.

Put the reviewer on a different model family from yours when your harness lets you pick one. Spawn a second reviewer on a third family only for a high-stakes change (an on-disk format, security, a core service), or when the user asks for a panel. Findings two reviewers raise independently are the highest signal.

If your harness has no subagent tool, review it yourself against the same rubric and lens, and label the result a self-review. It is weaker, because you share the author's blind spots.

## Step 4. Synthesize

Parse every finding. Merge findings that describe the same issue differently, and note which reviewer raised each one. Note disagreements between reviewers. If one flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5. Lead judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Read `references/lead-judgment.md` for the framework. Trace each finding against the real code before you bucket it. Put every finding in one of four buckets, with who raised it and a one-line rationale.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output format

### Intent

> [The stated intent paragraph from Step 2]

### Reviewers

- [label]: [model, if known], [N findings]

### Act on

[Each: description, who raised it, why it matters.]

### Consider

[Each: description, who raised it, the tradeoff.]

### Noted

[Brief list.]

### Dismissed

[Each with a brief rationale.]

### Agreement map

[Only with two or more reviewers. Where they agreed and diverged, and what that pattern tells us.]
