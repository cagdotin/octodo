### Feature

**You own the design and the build. Ground, shape, build, verify.**

1. **how** over the affected subsystem.
2. **architect** for the shape: data first, then signatures and module boundaries.
3. Write the throughput checkpoint as four todo items. A dimension that does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** What must land before anything else, such as a schema in `packages/contract/src/domain.ts` that the server, MCP, CLI, and web all derive from.
   - **Independent workstreams.** Disjoint packages or layers that could proceed in parallel. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (**principle-separate-before-serializing-shared-state**). Serialize only for real invariants.
   - **Smallest safe decomposition.** Usually one owner, you. Name why when it isn't.
4. Build it yourself against the sketch, with the data shape and its organizing structure named first per **principle-model-the-domain** (a state machine over scattered booleans, a table over branching, a typed schema over repeated shape assumptions). Hand a slice to a subagent only when it is a genuinely independent workstream from step 3. Keep to the repo's boundaries: Effect holds the logic, Hono stays thin, and the browser bundle imports only types from `@octodo/contract` plus `@octodo/contract/rules`, never `@octodo/engine`. Comments per **Comments**. Port shared-primitive improvements to every consumer and verify each.
5. Verify on the matching surface (see **Verify on the real surface**). A feature that changes what is written to disk gets its files read back. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Shape the history into small, ordered commits per **principle-sequence-verifiable-units**.
7. If the design is contested, or the diff is large enough that you would want a second reader, run **interrogate**.
8. Run **Opening a PR** when the task asks for one.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
