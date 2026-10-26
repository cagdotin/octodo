### Perf issue

**You own the measurement story. Measure, explain, fix, measure again.** Tie every fix to a measurement. Don't read source instead of measuring.

octodo has no tracing yet, so capture what the runtime already gives you: `node --cpu-prof` for the server, CLI, or a vitest run, the browser's Performance panel or a CDP trace for the web app, and Electron's DevTools for desktop. Time the user-visible operation end to end (a snapshot load, a move that renumbers folders, a board render on a large workspace). Build the workload with a script that generates a realistic scratch workspace, so the baseline can be rerun.

1. Capture a baseline on the matching surface. Vet it, and each later number, with the **benchmark-checklist** skill.
2. Run **how** to ground hypotheses. Don't claim a perf ceiling without running it first. Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.

3. Plan the fix from the trace. If it crosses a function boundary, run **architect** first. Make the change, then capture a post-fix trace under the same conditions. Verify each attempt before trying the next (**principle-sequence-verifiable-units**).
4. Compare the artifacts with a script, not by eye (dump the profile to sqlite or JSON and diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR or the commit body.
6. Run **Opening a PR** when the task asks for one.

If the same kind of measurement keeps coming up, propose adding Effect spans (`Effect.fn`, `Effect.withSpan`) and an exporter as an octodo task rather than instrumenting by hand again (**principle-encode-lessons-in-structure**). For sustained improvement against a metric, use the Hillclimb playbook.

**Reply:** baseline number, post-fix number, delta, artifact path.
