# Prompts worth copying

Swap in the real paths, skills, and done checks. Informal wording works.

## Understand

- `/octo-mode read <thread>. restate the underlying issue in your own words, in plain english.`
- `/in-your-own-words <long or messy ask>`
- `/sharpen <the prompt you're about to send>`
- `/octo-mode investigate why <symptom>. give me what we know, what data you used, and your best hypotheses. don't change any code yet.`
- `use /how to understand <subsystem>. then use /why to find out why it broke recently.`
- `/recall my work on <topic> from last week, then read <issue>.`
- `/teach me why you implemented it this way and not <other way>. what did you trade off?`
- `/octo-mode take over this branch. read the decision log, find what's done, and continue. don't redo finished work.`

## Build

- Bug: `/octo-mode <symptom>. repro first, then fix and verify.`
- Bug in the app: `/octo-mode repro this in the web app against a scratch workspace. if it repros on master, fix it and show me screenshots as proof.`
- Bug with a cheap test: `/octo-mode repro <bug> first. if there's a cheap test path, /tdd it. then fix and rerun.`
- Feature: `/octo-mode add <behavior>. <current output> stays byte-identical. verify both.`
- Refactor: `/octo-mode move <code> into one module, zero behavior change. record the current output first and prove it's unchanged after.`
- Perf: `/octo-mode <operation> takes <time> on <fixture>. trace it, fix the measured cause, show me before and after.`

## Design and plan

- `/octo-mode prototype a few options for <feature>. take screenshots or videos for me to compare.`
- `/octo-mode we need <feature>. /architect it first, and answer open questions with prototypes. let me review before proceeding.`
- `/octo-mode write a tutorial for how i would use <new package> first. then /teach me why it beats the current one.`
- `/octo-mode turn this design into a plan. small verifiable PRs, each with its own verification steps.`
- `/octo-mode plan the migration of <library> to <target>. small verifiable PRs. the result must match the original exactly, bugs included.`

## Review and ship

- `/interrogate the whole branch, but skeptically. don't change anything yet. no nitpicks unless it's a real bug or regression.` Read the dismissals too.
- `/create-formal-verification-skill prove <property> holds in <module>, even when <steps> interleave or retry.` After merges or refactors in that code: `/maintain-formal-verification-skill`.
- `/octo-mode commit this and open the pr. small ordered commits, evidence in the description.`
- `/octo-mode babysit this pr. get it green.` For status only: `/octo-mode check on pr <number>. anything outstanding?`

## Away and back

- `/octo-mode im going to bed. <goal> in a fresh worktree off master. done means <checks>. keep a decision log. don't ask me before committing. keep going until done. if you're truly stuck after a few hours, stop and write up why.`
- `/show-me-your-work catch me up on what you did last night.` Read its Attention section first.
- `/ketchup` catches you up on this chat since your last message and lists every call that waits on you.
- `/reflect capture what we learned so the next run doesn't repeat it.` Approve only edits that change a future decision.
- `/bro` restates the last reply in plain words.
