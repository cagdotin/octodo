### Refactoring

**You own the contract. The structure changes. The behavior does not.** Distinct from Feature, which adds behavior, and Bug fix, which corrects it.

If the cleanup reveals a missing feature or a real bug, split it out and ship the structural change first against the pinned contract. A redesign is allowed, but name it and route to Feature. Large or cross-cutting structural work belongs to the **figure-it-out** skill. This playbook is the focused-to-medium change.

1. Pin the behavior contract first. Run **how** over the affected subsystem to learn the contract, then write a characterization test, snapshot, or equivalence harness that captures current behavior before any structure moves. For anything that writes files, the pin includes the bytes on disk: run the same operations on a scratch workspace before and after and diff the folders. Type check and lint are not a pin.
2. Name the structure the code is missing per **principle-model-the-domain**. Boring code stays when the shape is already clear and local. The reshape must delete branches or invalid states, not add indirection.
3. Name the target shape: what the module layout, types, and call graph should be if built today (**principle-foundational-thinking**, **principle-redesign-from-first-principles**). If the target crosses a function boundary, run **architect** first.
4. Subtract before you add. Delete dead code, collapse one-caller wrappers, drop redundant validators, and remove orphan references before introducing the new shape (**principle-subtract-before-you-add**). The smallest change that reaches the target shape ships (**principle-laziness-protocol**).
5. Move in small behavior-preserving steps, each keeping the pin green. For API reshapes, migrate every caller and delete the old API in the same wave (**principle-migrate-callers-then-delete-legacy-apis**). No compatibility shims, no parallel old-and-new paths. Spot-check every rename against the actual files. Renames silently miss usages in strings, prose, skills, and `AGENTS.md`. For a mechanical edit across many files, write a codemod (**principle-build-the-lever**) instead of hand-editing or delegating.
6. Prove behavior is unchanged on the real artifact, not "it compiles" (**principle-prove-it-works**). For larger reshapes, run the equivalence check from step 1.
7. Confirm the change is worth keeping. The success measure is reduced reader load (**principle-minimize-reader-load**). If the diff does not lower reader load somewhere, revert it.
8. Shape the history into small ordered commits: a subtraction commit, then the reshape, then any follow-on cleanup (**principle-sequence-verifiable-units**). Run **Opening a PR** when the task asks for one.

**Reply:** the structure that changed, the pin you held it against, the equivalence proof, the reader-load delta, what shipped and what got reverted. No new behavior.
