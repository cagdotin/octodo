---
name: octo-help
description: Guides users through octo-mode and the octodo agent skills, and picks the skill, playbook, or principle for a task. Type /octo-help with a question.
disable-model-invocation: true
---

# Octo help

Answer the user's question about the octodo agent skills, hand them a prompt they can send, and link the file the answer came from. For a help question, don't start the work. The user asked how, and a full run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use octo-mode to fix this bug", is not a help question. Read [`octo-mode`](../octo-mode/SKILL.md) and do the work under it.

This file maps questions to the skills that hold the answers. Those files own the details. Read the file you route to before you quote it, and trust it when it disagrees with this map. Link files by their repo path, such as `.agents/skills/how/SKILL.md`.

## What these skills are

Skills adapted for this repo from [pstack](https://github.com/cursor/plugins/tree/main/pstack), for any harness that reads `.agents/skills/` (Claude Code through the `.claude/skills` symlink, Codex, opencode, and others). They do the work inline and spawn subagents only where independence or bulk earns it.

## Find out what they need

Infer the need from the message and the conversation. If it is still unclear, ask one multiple-choice question with these options, then answer only the part they pick:

- Start a task with `/octo-mode`
- Pick a skill for a situation
- Fix a run that went wrong
- Change the skills themselves

Mention when it matters that the repo has no `verify-octodo` skill yet, so agents prove behavior with the list in **Verify on the real surface** in `octo-mode`. `/create-verification-skill` builds one.

## Start a task with `/octo-mode`

`/octo-mode` matches the task to a playbook, copies the playbook's steps into the todo list, and runs the other skills as the steps need them. A step it skips stays in the list as `skip: <reason>`. A good prompt states the goal and how to tell it's done. It doesn't list skills, because a hand-written sequence tends to drop or reorder steps the playbook would keep. Read [`references/prompting.md`](references/prompting.md) before you help word one.

How long the mode stays on depends on the harness. Where a skill is attached to one message, start each new task with `/octo-mode`. Mid-chat, "new task" makes the mode match a fresh playbook.

## Pick a skill

The default answer is `/octo-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives. Read the skill before you recommend it, and give one example prompt.

| The user wants to                                                          | Skill                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Do any non-trivial task with rigor                                         | [`/octo-mode`](../octo-mode/SKILL.md)                                                   |
| Check that the agent understood their goal before it starts                | [`/in-your-own-words`](../in-your-own-words/SKILL.md)                                   |
| Get a prompt rewritten deeper, not bigger, before sending it               | [`/sharpen`](../sharpen/SKILL.md)                                                       |
| Know how code works now, or where new code should live                     | [`/how`](../how/SKILL.md)                                                               |
| Know why code is shaped this way, or where a number came from              | [`/why`](../why/SKILL.md)                                                               |
| Understand a change or subsystem, explained plainly                        | [`/teach`](../teach/SKILL.md)                                                           |
| Catch up on their own recent work on a topic                               | [`/recall`](../recall/SKILL.md)                                                         |
| Catch up on what changed in this chat since their last message             | [`/ketchup`](../ketchup/SKILL.md)                                                       |
| Know what a small diff could break outside itself                          | [`/blast-radius`](../blast-radius/SKILL.md)                                             |
| Find where the architecture hurts and which refactor to do first           | [`/improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md)           |
| Settle types and module shape before code that crosses a function boundary | [`/architect`](../architect/SKILL.md)                                                   |
| Have an independent reviewer try to break a diff                           | [`/interrogate`](../interrogate/SKILL.md)                                               |
| Fix a bug test-first when a cheap local test exists                        | [`/tdd`](../tdd/SKILL.md)                                                               |
| Apply the TypeScript and Effect rules to `.ts` or `.tsx` work              | [`/typescript-best-practices`](../typescript-best-practices/SKILL.md)                   |
| Turn the comments in a diff into clearer code, or delete them              | [`/comment-review`](../comment-review/SKILL.md)                                         |
| Clean AI tells out of prose                                                | [`/unslop`](../unslop/SKILL.md)                                                         |
| Write docs, a README, a PR description, or a commit message to a standard  | [`/technical-writing`](../technical-writing/SKILL.md)                                   |
| Hear the last reply again in plain words                                   | [`/bro`](../bro/SKILL.md)                                                               |
| Give agents a scripted way to drive the app and prove behavior             | [`/create-verification-skill`](../create-verification-skill/SKILL.md)                   |
| Bring a verification skill back in line with the app                       | [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md)               |
| Formally verify a race or invariant that tests rarely reach                | [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md)     |
| Bring a formal verification back in line after the code changed            | [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Vet a performance number before reporting or acting on it                  | [`/benchmark-checklist`](../benchmark-checklist/SKILL.md)                               |
| Run a large or cross-cutting change, or one to review after stepping away  | [`/figure-it-out`](../figure-it-out/SKILL.md)                                           |
| Keep a decision log during a run, and review it afterward                  | [`/show-me-your-work`](../show-me-your-work/SKILL.md)                                   |
| Turn their own working habits into a personal mode skill                   | [`/automate-me`](../automate-me/SKILL.md)                                               |
| Turn what a finished task taught into skill edits                          | [`/reflect`](../reflect/SKILL.md)                                                       |
| Stop agents from repeating the same mistakes in this repo                  | [`/correct`](../correct/SKILL.md)                                                       |
| Read or manage the project's tasks                                         | [`/octodo`](../octodo/SKILL.md)                                                         |
| Build or style UI components                                               | [`/shadcn`](../shadcn/SKILL.md)                                                         |
| Find their way around these skills                                         | `/octo-help`                                                                            |

If a skill directory next to this one is missing from the table, read its frontmatter and route by its description. The `principle-*` directories are covered below.

Close calls:

- `/how` explains what the code does. `/why` explains the reasons. `/teach` runs one or both and explains the result plainly.
- `/improve-codebase-architecture` scans for shallow modules and reports candidates. `/architect` shapes one change you already chose.
- `/architect` writes two candidate shapes itself and implements right after it settles the design. Add "with checkpoint" to review the design first.
- `/interrogate` reviews the diff. `/blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.
- `/recall` rebuilds context across recent chats. `/ketchup` covers only this chat since the user's last message. Resuming one specific chat or branch is the Session pickup playbook.

## Playbooks and principles

Playbooks are step lists inside `/octo-mode`, not skills, so they have no slash command. Describing the task picks one, and these phrases name one directly:

- "babysit this pr" or "check on pr 12" runs Babysit. It drives the PR to merge-ready and stops there.
- "take over this branch" runs Session pickup.
- "pause safely" runs Pause safely.
- "plan this" for work that spans several PRs runs Multi-phase plan, which writes the plan and doesn't implement it.
- "run an eval of this skill change" runs Eval.

Principles are one-rule skills that `/octo-mode` reads and cites in its replies. The user rarely invokes one. They steer with the names instead, as in "apply prove it works. show me the real output."

## Fix a run that went wrong

| Symptom                                                  | Fix                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The mode stopped applying after a few turns              | Start each task with `/octo-mode`, or say "octo mode" again.                           |
| A question got treated as the next step of the last task | Say "new task".                                                                        |
| The run spawned more agents than the task needed         | Point at the Subagents section of `octo-mode`: inline by default.                      |
| Parallel agents overwrote each other                     | Give each agent its own git worktree and its own scratch `OCTODO_HOME`.                |
| A long run moved but finished nothing                    | It needs a check that can pass or fail, not a duration.                                |
| The reply claims success from a green build              | Ask for the real command, flow, or files on disk. That's the prove-it-works principle. |

For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers, and [`references/recipes.md`](references/recipes.md) has prompts worth copying.

## Change the skills themselves

- `/octo-mode write a skill for <workflow>` runs the authoring playbook.
- `/reflect` after a session turns its lessons into skill edits the user approves.
- `/automate-me` drafts a personal mode skill from the user's own history.
- Fix a misbehaving skill in its own commit, not inside the feature work where it went wrong.

## Reply

Lead with the answer. Give at most one example prompt in a code block, adapted from [`references/recipes.md`](references/recipes.md) when one fits. Keep it short unless the user asked for the whole map.
