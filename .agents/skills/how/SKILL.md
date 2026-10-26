---
name: how
description: 'Use for "how does X work", code walkthroughs before changing something, and placement / ownership / layering questions ("where should this live", "which package owns this", "is this the right layer"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation.'
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Start from `AGENTS.md`, which describes the on-disk model and the package layout. The usual flow runs from `packages/core` (schemas in `domain.ts`, folder rules in `layout.ts`, the markdown round-trip in `markdown.ts`, the `Workspace` and `Workspaces` services) out to the adapters: `packages/server` (Hono), `packages/mcp`, `packages/cli`, and `apps/web` and `apps/desktop`.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): explore and explain yourself, in one pass. Go to step 4.
- **Complex** (a flow that spans several packages, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem, such as "the core service", "the HTTP and MCP adapters", "how the web app consumes it". Trace each angle yourself, recording what `references/explorer-prompt.md` asks for.

Hand the angles to read-only subagents instead only when tracing them would flood your context: many large files, or angles that are independent and deep. Spawn them in one message, each with `references/explorer-prompt.md` and its angle filled in, and tell them not to edit files.

## 3. Synthesize (complex only)

Reconcile the angles into one picture with `references/explainer-prompt.md` as your guide. Merge overlaps, resolve contradictions by checking the code yourself, and say what stayed open.

## 4. Present

Use the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
