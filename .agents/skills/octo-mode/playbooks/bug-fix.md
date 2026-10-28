### Bug fix

**You own this task. Reproduce, root-cause, fix, verify.**

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the surface where it was reported (see **Verify on the real surface** in `../SKILL.md`), in a scratch workspace. Ask the user only with a specific reason the surface is out of reach, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires. For file-model bugs, suspect the files first: a missing `id`, a duplicate `id`, a file octodo did not write. A file broken outside octodo must show up as a diagnostic. If it doesn't, the missing diagnostic is the bug, not a missing repair.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with **how** over the affected subsystem and **why** for regression history (`git log` on the files, the octodo task that asked for the change). Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add logging (`Effect.logDebug`, or a temporary `console.error` you delete before commit) and read it as the code runs. Don't guess. Confirm the surviving _mechanism_ with runtime evidence before you plan the fix.
3. Plan the fix. If it crosses a function boundary, run **architect** first. Fix it at the root (**principle-fix-root-causes**), and fix every other site with the same fault.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. Use the **tdd** skill when the bug has a cheap test path, which is usually true for `packages/engine` (`vitest` against a temp folder, as in `packages/engine/test/`). Skip it when the test would be expensive, integration-heavy, or unclear. This is the canonical **principle-sequence-verifiable-units** shape: the failing test first, the fix on top.
6. Run **Opening a PR** when the task asks for one.

**Reply:** what was broken, root cause, fix, how you verified. Paste the failing-then-passing repro output verbatim.
