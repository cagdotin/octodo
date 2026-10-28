---
name: improve-codebase-architecture
description: "Scan the codebase for deepening opportunities (shallow modules that should become deep ones), report them as a structured markdown message, then question the user through whichever one they pick. Use for /improve-codebase-architecture, or when asked where the architecture hurts and what to refactor first."
disable-model-invocation: true
---

# Improve codebase architecture

Find architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is code that is easy to test and easy for an agent to navigate.

Two sources of language shape every suggestion:

- **The architecture vocabulary** in [`references/vocabulary.md`](references/vocabulary.md): module, interface, implementation, depth, seam, adapter, leverage, locality, and the principles built on them (the deletion test, "the interface is the test surface", "one adapter is a hypothetical seam, two is a real one"). Read it before you start, and use these terms exactly. Don't drift into "component", "API" or "boundary".
- **The domain language** of octodo: workspace, task, status, list, and the on-disk model in `AGENTS.md`, plus `docs/glossary.md` if it exists. Name a candidate after the concept it serves ("the task file round-trip module"), not after a file or a class.

Decisions not to re-litigate: the Decisions and Security sections of `AGENTS.md`, `docs/vision.md`, and any record in `docs/adr/`. See [`references/domain-records.md`](references/domain-records.md).

## 1. Explore

**Scope before you scan.** Deepening a module pays off by making future changes to it cheaper, so weight the parts of the codebase that change often. Decide where to look before you look:

- If the user named a direction (a package, a subsystem, a pain point), take it and skip the inference below.
- Otherwise, walk back a good stretch of history to find the hot spots: `git log --oneline -n 200`, and `git log --format= --name-only -n 200 | sort | uniq -c | sort -rn | head -30` for the files that keep changing. Open `.octodo/` tasks in those areas count too. If the changes are scattered with no hot spot, widen the net.

Read the domain records for the area first. Then walk the code yourself, the way the **how** skill does: follow real call paths, and note where you feel friction rather than running a checklist. Spawn a subagent only for a broad sweep whose file dumps you don't need, and give it the vocabulary file and the questions below.

- Where does understanding one concept mean bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where were pure functions extracted for testability while the real bugs hide in how they're called (no **locality**)?
- Where do tightly coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?
- In this repo specifically: logic in a Hono route, a CLI command, an MCP tool or a React hook that belongs behind an `@octodo/engine` service or in `@octodo/contract/rules`; folder and frontmatter rules decided in more than one place; types that the server and web app keep in sync by hand.

Apply the **deletion test** to anything you suspect is shallow. Would deleting it concentrate complexity, or just move it? "Concentrates" is the signal you want. Screen each candidate against `../architect/references/design-red-flags.md`.

## 2. Report the candidates

Reply with a structured markdown message. No HTML file, and no file in the repo. Order the candidates strongest first, and keep each one short enough to read in one pass.

```markdown
## Architecture review: <scope>

<One or two sentences: what you scanned and why, such as the hot spots from git history.>

### 1. <Candidate, named in domain terms> (Strong | Worth exploring | Speculative)

- **Files:** `path/a.ts`, `path/b.ts`
- **Problem:** why the current shape causes friction, in the vocabulary's terms.
- **Solution:** what would change, in plain words. No interface yet.
- **Benefits:** locality (where change and bugs would concentrate), leverage (what callers stop knowing), tests (what becomes testable through the interface, and which tests would go).
- **Before / after:** optional. A few lines of text, or a small Mermaid graph when the shape is a graph.
- **Conflicts:** only when it contradicts a recorded decision, and why the friction is worth reopening it.

### 2. ...

## Top recommendation

<Which candidate to tackle first, and why that one.>

Which of these would you like to explore?
```

Surface a conflict with a recorded decision only when the friction is real enough to reopen it. Don't list every refactor a decision rules out. Don't propose interfaces yet; that comes after the user picks.

If the user wants something richer to look at, a page or diagram can come later through whatever the harness offers. The message is the report.

## 3. Question the chosen candidate

Once the user picks one, map the open decisions as a tree: constraints, dependencies and their category (see the vocabulary file), the shape of the deepened module, what sits behind the seam, and which tests survive. Each decision branches into the ones that depend on it.

Work the tree in rounds. The frontier is every decision whose prerequisites are already settled. Ask the whole frontier in one round, numbered, each with your recommended answer, worded so that "yes" accepts it:

```markdown
**Q1. <title>:** <the question, with the options if there are several>

Recommended: <your answer, and why>
```

Then wait for the answers, recompute the frontier, and ask the next round. A question that depends on another one still open belongs to a later round.

Facts are your job, never the user's. When a question needs a fact from the code, git or the running app, find it yourself and keep asking the questions that don't depend on it. Decisions are the user's. The session ends when the frontier is empty and the user confirms you share an understanding. Don't change code before that.

Keep the domain records current as decisions settle (see [`references/domain-records.md`](references/domain-records.md)):

- Naming the deepened module after a concept the glossary doesn't have? Add the term.
- Sharpening a fuzzy term? Update it right there.
- The user rejects the candidate with a reason a future review would need? Offer to record it: "Want me to record this so future architecture reviews don't suggest it again?" Skip passing reasons ("not now") and obvious ones.

To explore alternative interfaces for the deepened module, use the **architect** skill's Phase B (`../architect/SKILL.md`): at least two structurally distinct candidates, written inline. Good contrasting constraints are a minimal interface (one to three entry points), the most common caller's case made trivial, and ports and adapters for the dependencies that cross the seam. Compare them on depth, locality and seam placement, and give your own pick.

When the design is settled, hand it to **architect** to implement, or record it as an octodo task if the user wants it later.
