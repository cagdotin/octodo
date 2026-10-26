---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, or where a number came from. Searches the evidence octodo actually has (git history, GitHub PRs and issues, the octodo tasks in .octodo/ and their history, docs/ and AGENTS.md, past agent sessions) and returns a cited, confidence-weighted read on decisions and tradeoffs. Use how for runtime behavior."
disable-model-invocation: true
---

# Why

Investigate the motivation and intent behind code. The companion **how** skill answers what the code does and how it works. **why** answers what forces led to its shape.

## Operating posture

Operate as a **careful, cautious, and precise investigator**. Be honest about what you know vs what you're inferring. Read `references/epistemics.md` for the confidence framework and phrasing guide, and follow it when you write the answer.

## Step 1. Understand the target and the question

The **target** is usually a chunk of code, a pattern, a feature, or a named design decision. The **question** is usually a design rationale, a tradeoff, a motivating edge case, an external constraint, dead code, or a broad history sweep.

If the target is vague, make your best guess from conversation context (open files, recent edits, what was just discussed). State your interpretation briefly so the user can redirect, then proceed.

## Step 2. Establish the code anchor

Build the seed context: file paths and line ranges, key symbols, the last few commits touching the target, PR numbers from merge commits (pattern `(#12)` in the subject line), and any octodo task ids (`OCT-12`) in commit messages, PR bodies, or comments. The commands are in `references/sources/code-archaeology.md`.

## Step 3. Search each evidence source

Default to a full sweep. The goal is a complete coverage map, not a minimal one. Document the null, don't skip the search.

The sources octodo has, each with its playbook in `references/sources/` (index: `references/source-playbook.md`):

1. **Source control** (git, `gh` for PRs). Always available. Best at _implementation-time rationale captured in commits and review_.
2. **Task tracker** (`.octodo/` task files and their git history, including tasks that were deleted). Best at _the product reason and the plan before the code_. The task body often records the decision, and its history shows when the plan changed.
3. **Long-form docs** (`docs/`, `AGENTS.md`, `README.md`, a skill's `SKILL.md`). Best at _design direction and rules written down on purpose_.
4. **Past agent sessions** (this workspace's transcripts). Best at _deliberation that never reached a commit message_: the user's correction, the rejected approach, the reason given in chat.

octodo has no observability, error tracking, or analytics yet. Say so in Sources consulted rather than skipping silently. When one of those exists, add a playbook for it under `references/sources/` and a line here.

Run the sources yourself, one at a time. The investigation is usually a few `git` and `rg` calls. Hand a source to a subagent only when it is bulky enough to flood your context, which in practice means a sweep across many long agent transcripts. Give that subagent `references/investigator-prompt.md` with the source's playbook appended, and tell it not to edit anything.

### When to skip a source

Only with an **explicit, written justification** that goes in Sources consulted: the source is unavailable ("no past sessions for this workspace"), or it is provably irrelevant ("the target predates the first task file"). If the PR description already holds the complete answer, you may stop early, but say which sources you skipped and why.

## Step 4. Synthesize

Weigh the evidence yourself and write the answer with `references/synthesizer-prompt.md` as the structure and `references/epistemics.md` as the rules.

## Output format

The structure is the one in `references/synthesizer-prompt.md`: The question, The code in question, What we found, What we can reasonably infer, Competing hypotheses, What we don't know, Sources consulted, Confidence summary. Keep the confidence separation intact, and keep Sources consulted as one line per source, including the ones that returned nothing or were skipped, with the reason.

If the question is a precursor to changing this code, end with a Preserve / Change / Avoid / Risk constraint set for planning the change.

## Common failure modes to avoid

- **Recency bias.** Assuming the most recent commit is authoritative. The current shape is often the accretion of many earlier decisions. Trace back.
- **Path-based history.** Task files and status folders get renamed when a task moves or a folder is renumbered. Follow history by id and content, not by the current path.
