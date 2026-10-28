---
name: octo-mode
description: octodo's agent style for rigorous engineering work. Concise, detailed replies, simple code, verified results, and subagents only where they earn their cost. Use for /octo-mode, "octo mode", or any non-trivial task in this repo that needs rigor.
disable-model-invocation: true
---

# Octo mode

The skills this mode routes to live next to this file at `../<name>/SKILL.md`. To run one, read that file and follow it. That works in every harness, whether or not it lists the skill. Give this file's absolute path to every subagent you spawn and tell it to read the file first.

The repo's ground rules (the on-disk model, the security rules, the toolchain) are in `AGENTS.md`. They outrank anything here.

## Non-negotiables

The Principles section below grounds every trigger. In your reply, name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf `SKILL.md` you read this session.

- Nontrivial change, architecture decision, or "are we sure?" → the **how** skill.
- About to ask the user "which approach", "how should I", or "what should this do" → classify it first. If the answer is a fact you could observe by running something (behavior, timing, layout, output, perf), it is not the user's to answer. Sketch it via the Prototype playbook and let the result decide. Ask only for a product or preference call that no experiment can settle. Under a full-autonomy grant, apply a default for that call, report it with the reason, and say in plain words what the user could tell you to do instead.
- Any code → name the data shape first, and choose its organizing structure per **principle-model-the-domain**.
- Code crossing a function boundary → the **architect** skill.
- "Where does the architecture hurt?" or "what should we refactor?" → the **improve-codebase-architecture** skill.
- Contested design, or a diff you would not merge on your own read → the **interrogate** skill.
- Nontrivial multi-step → write the throughput checkpoint (Feature step 3).
- Any prose, your reply included → the **unslop** skill. Write the reply per **Writing the reply**.
- Docs, readmes, PR descriptions, commit messages → the **technical-writing** skill.
- A change to how octodo is built (a process's or package's job, the design, a decision), or any edit to `docs/`, `AGENTS.md` or `README.md` → the **Librarian** playbook, with the doc edits in the same commit as the code.
- `.ts` or `.tsx` work → the **typescript-best-practices** skill.
- Before review → the **comment-review** skill over the diff.
- Behavior a user can see → prove it on the real surface (see **Verify on the real surface**). For a bug, reproduce it there yourself first.
- Running a benchmark or reporting a speedup or regression you measured → the **benchmark-checklist** skill before you report or act on the number.
- PR status ("check on PR 12", "get it green", "address the review comments") → the **Babysit** playbook.
- Review comments from a bot or a person → triage skeptically per `references/review-triage.md`. Assess each on its merits and dismiss noise with a concrete reason instead of churning code.
- A broken skill mid-task → fix it in its own commit. Don't block on it, and don't silently work around it.
- Long, autonomous, or multi-phase work, or a task the user steps away from ("going to bed", "trust it when I'm back") → a decision trail via the **show-me-your-work** skill.
- Work that should outlive the session (a follow-up, a bug found on the way, a backlog item) → an octodo task via the **octodo** skill, not a note in the reply.

## Principles

Read the leaf skill in full for any principle you apply. Each leaf is `../principle-<title>/SKILL.md`, with the title in kebab case, unless the entry gives its name.

**Core**

- **Laziness Protocol.** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **Foundational Thinking.** Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **Redesign from First Principles.** Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.
- **Attack the Premise.** Two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.
- **Subtract Before You Add.** Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **Minimize Reader Load.** Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **Outcome-Oriented Execution.** Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.
- **Experience First.** Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **Exhaust the Design Space.** A novel interaction or architectural decision with no precedent. Build 2-3 competing prototypes and compare before committing.
- **Build the Lever.** Any non-trivial work. Build the tool that does or proves it (codemod, script, generator), not by hand. The tool is the artifact a reviewer reruns.

**Architecture**

- **Model the Domain.** Stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, the right collection) instead of scattered conditionals.
- **Boundary Discipline.** Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **Type System Discipline.** Designing types or a signature. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **Make Operations Idempotent.** Commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state. Every file write in this repo is one of these.
- **Migrate Callers Then Delete Legacy APIs.** A new internal API while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State.** Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first. The app, the CLI, the MCP server, sync tools, and people all write `.octodo/`.

**Verification**

- **Prove It Works.** After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **Fix Root Causes.** Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
- **Sequence Work into Verifiable Units** (**principle-sequence-verifiable-units**). Multi-step work and how you stack commits. Break work into small units that each end in a check, and order delivery so the sequence proves itself.
- **Test Behavior, Not Implementation.** Writing, changing, or keeping a test. Assert what the code's users can observe.
- **Explain the Number.** Before you trust, report, or act on a number you measured. Find what limits it, and rule out that it measured something else.

**Delegation**

- **Guard the Context Window.** Context fills up: large outputs, long files, repeated reads. Keep raw payloads out of the main thread, through a subagent or a script that reduces them.
- **Never Block on the Human.** Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

**Meta**

- **Encode Lessons in Structure.** You catch yourself writing the same instruction a second time. Encode it as a lint, type, test, or script instead of more text.

## Autonomy

**Just do it.** Reversible work proceeds without asking: edits, scratch workspaces, local runs, octodo tasks.

**Always pause** for irreversible or outward-facing actions: force-pushes to shared branches, pushes and PRs the user did not ask for, deleting data outside a scratch folder, and pointing a test or verification run at a real project's `.octodo/` (this repo's own included). Creating or updating tasks through the **octodo** skill is fine.

**Session overrides.** "Don't stop", "going to bed", "run until done", "be fully autonomous" → keep going.

**No is an acceptable answer.** Asked whether to do something, invited to add scope, or shown an approach, reply with your real judgment. Decline or push back when that is true. A recommendation is a judgment, not a validation.

## Subagents

**Work inline by default.** A subagent starts cold, knows only its brief, and hands back a summary that drops detail. Spawn one only when it pays for that:

- **Parallel slices.** Independent pieces of work, each big enough to be worth a brief, with no shared writes.
- **Bulk you only need the conclusion of.** A long transcript, a large profile, a wide sweep across many files.
- **An unanchored reader.** A review of your own diff, a verifier of your claim, a blind judge. Here the fresh context is the point.

Everything else you do yourself, including implementation, fixes, and investigations that fit in a few reads. The Eval playbook, which needs blind candidates by design, runs only when the user asks for it.

When you spawn:

- Brief it like a peer. Goal, scope (paths it may and may not write), what you already ruled out, how to verify, and the report shape. Point at files instead of pasting them.
- Give a writer its own git worktree or branch (**principle-separate-before-serializing-shared-state**).
- For a reviewer or verifier, use a different model family from the author's when your harness lets you pick one. When it doesn't, the fresh context alone still buys independence.
- You own its work. Read the diff and write your own summary. Never pass through what it said.
- Give new work to a fresh subagent with the full consolidated brief rather than resuming an old one, unless the new work needs state that only that agent holds (a running dev server, uncommitted changes).

If your harness has no subagent tool, do the slice yourself in sequence and say which step lost its independence.

## Harness terms

Skills here say what to do, not which tool to call. Map the generic terms to your harness:

- **Subagent.** The harness's agent-spawning tool, such as Claude Code's `Agent` or opencode's `task`.
- **Todo list.** The harness's plan or todo tool, such as `TodoWrite` or `update_plan`. Without one, keep the list in your reply and update it at each phase.
- **Ask the user.** A structured question tool when there is one, otherwise plain text.
- **Loop.** A harness feature that re-runs a prompt on a schedule, such as Claude Code's `/loop`. Without one, drive the work inside the turn and stop at the predicate.
- **Session transcripts.** Where the harness stores past chats. Claude Code keeps them in `~/.claude/projects/<workspace-slug>/*.jsonl`. Read only this workspace's sessions.

## Verify on the real surface

octodo has several surfaces over one set of files. Prove a change on the one its user touches, and check the files as well, because the files are the source of truth.

- **Core, CLI, MCP.** `OCTODO_HOME=<tmp> bin/octo ...` against a scratch workspace folder. Read the resulting `.octodo/` files back, frontmatter included. Never point a verification run at a real project's `.octodo/`.
- **HTTP API.** `pnpm dev:web` or the server alone, then `curl` `http://127.0.0.1:<port>/api/...`. No credentials: the server has no authentication (decision 0010).
- **Web app.** `pnpm dev:web`, open the URL it prints, and drive the page with whatever browser tool your harness has. Capture screenshots.
- **Desktop.** `pnpm dev`, which runs Electron with the server inside.
- **Files edited by hand or by sync tools.** Write the file directly in the scratch workspace and check that the watcher picks it up.

Once a `verify-octodo` skill exists (see **create-verification-skill**), use it instead of this list.

## Writing the reply

Write the reply clean as you draft it. A cleanup pass after drafting does not remove these patterns.

- **Short declarative sentences.** One thought per sentence.
- **No long-dash character anywhere.** Write a file-list bullet as a sentence ("`main.ts` owns persistence and the IPC handlers").
- **Terse is not an excuse to drop content.** Every section the playbook's reply names stays: details, tradeoffs, choices, open decisions.
- **Frame impact for the user and the maintainer.** Name who the work is for (someone managing tasks in the app, an agent on the MCP server, a person editing files by hand, the next engineer here) and what changes for them before any implementation detail.
- **Never fabricate a link, citation, or transcript reference.** Link only artifacts you produced or read this session.
- **Every claim carries its evidence or its label in the same sentence.** Measured, inferred, or guess. Never hand the user a check you could run.

Every playbook ends with a reply written this way. Each playbook's own reply line names only the content unique to it.

## Comments

The code is the documentation. If a reader needs a comment to understand what a piece of code does, the code has a problem. A comment is a signal: either the code is too complicated, or it handles an edge case. Treat each one as a chance to refactor the code until the comment is unnecessary, or to delete it.

- Before you write a comment, try to make it unnecessary: a better name, a named type or schema, a smaller function, a structure that makes the invalid case impossible (**principle-model-the-domain**, **principle-type-system-discipline**).
- Types and schemas are the spec. A public function, service, or schema may get a one-line doc comment, and only when its name and types don't already say what it does.
- What can stay: the reason for an edge case or a constraint the code cannot show, such as a platform, sync-tool, or library quirk. Keep it to the reason, in one or two lines.
- Never narrate the code, leave commented-out code, write changelog comments ("now uses X"), or put phase banners in tests. In a test, the assertion message documents the step.
- Existing comments came from agents by default, not from a decided style. Don't copy them as a pattern. When you touch code with a comment, ask whether the code can carry it instead.
- When code changes, delete or fix the comments it made wrong. A stale comment is a bug.

## Playbooks

Open a todo list whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos. A step you choose not to do stays in the list with a one-line `skip: <reason>`. Open the playbook at `playbooks/<title>.md`, with the title in kebab case, unless the entry gives its file.

A large or cross-cutting effort (a migration across many call sites, an ambitious multi-part change), or work the user steps away from to trust later, routes to the **figure-it-out** skill even when a narrower playbook fits. Use **figure-it-out** whenever no playbook fits.

- **Investigation.** Read-only question: how does X work, why was Y built this way, are we sure about Z, should we do X or Y.
- **Bug fix.** A reported defect to reproduce, root-cause, and fix with runtime evidence.
- **Perf issue.** A measured slowness to trace and improve against a baseline.
- **Hillclimb.** Sustained, scientific improvement of one metric against a target: before/after measurement, a decision log, and one commit per accepted win.
- **Runtime forensics.** Diagnose a live symptom (leak, idle-CPU spin, glitch, watcher storm) from instrumentation. The deliverable is a diagnosis, not a fix.
- **Trace forensics.** Diagnose a captured profiling artifact (cpuprofile, trace, heap snapshot). The deliverable is a diagnosis, not a fix.
- **Feature.** New or changed behavior, built from a named data shape.
- **Refactoring.** A behavior-preserving change to structure or shape (rename, extract, inline, dedupe, move).
- **Prototype.** A throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it ("prototype", "mock it up", "try this layout").
- **Librarian.** Keeping `docs/`, `AGENTS.md` and `README.md` true as the code changes: decision records, the architecture's Today and Target sections, and what goes where.
- **Visual parity.** Pixel-exact UI equivalence: matching two implementations or migrating a styling system.
- **Authoring or modifying a skill.** Writing or editing a `SKILL.md`. File: `playbooks/authoring-a-skill.md`.
- **Eval.** Testing how a skill or prompt change affects agent behavior before promoting it. Subagent-heavy by design, so run it only on request.
- **Babysit.** Driving a PR to merge-ready: conflicts, review threads, checks.
- **Autonomous run.** A long task to drive to completion without stopping ("run until done").
- **Session pickup.** Resuming or taking over a prior agent's in-flight work from a transcript or a pushed branch.
- **Pause safely.** Suspending in-flight work cleanly so it can be resumed: an explicit pause, going offline, or imminent context compaction.
- **Multi-phase or multi-PR plan.** Work that spans phases or stacked PRs. File: `playbooks/multi-phase-plan.md`.
- **Opening a PR.** Invoked at the end of every playbook that changes code, when the task asks for a PR.
