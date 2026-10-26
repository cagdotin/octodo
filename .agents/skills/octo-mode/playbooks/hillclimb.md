### Hillclimb

**You own the metric and the experiment's integrity.** For sustained, iterative improvement of one measurable thing against a target. A one-off fix is Bug fix or Perf issue. This is the loop.

Core discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from code inspection (**principle-prove-it-works**).

1. Ground the workload and architecture before choosing the metric. Run **how** over the target, name the workload dimensions that can move the result (task count, list depth, file size, watcher churn, concurrency), and pick a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing. Then fix one metric, the direction that counts as better, and a checkable stop predicate that pairs a target with a floor on attempts, such as "at least 50% better than baseline and at least 10 iterations". Use the user's numbers when given, otherwise agree them.
2. Build the measurement harness, prove its sensitivity, then freeze it (**principle-build-the-lever**). A script that generates the scratch workspace and times the operation is the usual shape. Run contrasting workloads and confirm the target case reproduces the symptom while easier cases separate as expected. Vet the harness with **benchmark-checklist**, and make it print its error count and a count of the work done. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Record the baseline and a green `pnpm test` before any change.
3. Open the decision log via **show-me-your-work**. A `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note. Read it before each attempt. Keep it out of the tree.
4. Ground each hypothesis in the architecture from step 1, so it names a specific mechanism ("stop re-reading every task file on each watcher event because only one changed"), not "try memoizing something". For a perf metric, order hypotheses by the mantras in the Perf issue playbook.
5. Loop, one hypothesis per iteration:
   - Make the change yourself. When several independent hypotheses are live and each is expensive to try, you may fan them out to subagents, each in its own worktree (**principle-separate-before-serializing-shared-state**). Review every diff yourself.
   - Measure before and after with the frozen harness, and run the regression gate.
   - Accept only when the metric moves past noise and the gate stays green. Otherwise revert the change in full.
   - One commit per accepted fix, staging only the files you changed (`git add <files>`, never `-A`). Log the row either way.
6. Push past the first plateau. After several rejects in a row, pivot category, combine near-misses, re-read the source, or try something more radical before concluding. Correctness and simplicity outrank the number. Revert a win that breaks behavior, and keep a simplification that holds the number (**principle-laziness-protocol**).
7. Stop when the predicate is met, or when the remaining ideas are marginal. Don't relax the predicate to meet it. If you are stuck, say so instead of spinning.
8. Run **Opening a PR** with the accepted commits in the order they landed, when the task asks for one.

**Reply:** the metric and target, baseline to final with the percent delta, iterations run (kept vs reverted), each accepted fix on one line, the `decision.tsv` path, and the best idea you would try next.
