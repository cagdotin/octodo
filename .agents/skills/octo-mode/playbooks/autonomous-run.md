### Autonomous run

**You own the exit condition. Define done, then drive to it without stopping.**

1. State the exit condition as a checkable predicate before the first iteration (`pnpm check` green, repro fixed, pixel diff zero).
2. Pick the wake mechanism. If your harness has a loop feature, use it, with a check interval sized to when the result is worth re-checking. Otherwise drive the work inside the turn.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, and discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride. Verify each unit before the next (**principle-sequence-verifiable-units**).
4. Mid-run discoveries are yours. Fix broken skills, related bugs, flaky tests, and tooling failures yourself, each in its own commit. File what is out of scope as an octodo task. Do not park reversible work for the human. Surface only irreversible actions, product or preference calls no experiment can settle, or a real dead end. Return to the predicate after each side fix.
5. Checkpoint every iteration via **show-me-your-work**, a row for what changed and whether the predicate moved.
6. Stop when the predicate is met. A plateau is not a stop, so pivot your approach to push past it. Surface a genuine dead end rather than spinning, and never relax the predicate to declare victory.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.
