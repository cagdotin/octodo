### Runtime forensics

**You own the diagnosis. Instrument the live process, don't theorize from source.** The deliverable is a cited diagnosis, not a fix.

1. Capture the live signal on the matching surface: a CPU profile for a spinning process (`node --cpu-prof`, or the inspector with `--inspect`), a heap snapshot for a leak, a browser or Electron trace for a visual glitch, a log of watcher events for a file-sync storm. A real artifact, not a guess.
2. Reduce the artifact to the smoking gun: the function on the hot path, the retainer chain from the leaked object to a GC root, the loop firing without input. Reduce a large artifact with a script, or in a subagent, and keep only the finding in the main thread (**principle-guard-the-context-window**).
3. Prove the mechanism before believing it. Add a log line or a counter in a scratch checkout, or evaluate an expression in the running process through the inspector, to confirm the hypothesis cheaply.
4. Map the finding back to source: file, symbol, the line that allocates or schedules.
5. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

**Reply:** the signal captured, the reduced finding, how you proved the mechanism, the source location, artifact paths. No fix unless asked. Hand back to Bug fix or Perf issue once the cause is known.
