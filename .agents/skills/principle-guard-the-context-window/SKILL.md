---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads. Keep raw payloads out of the main thread. Reduce them with a script, read only the slice you need, or hand bulk to a subagent and keep its summary."
disable-model-invocation: true
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**

- **Reduce before you read.** Filter a large output with a script, `rg`, `jq`, or `head` instead of reading it whole. Read the slice of a file you need, not the file.
- **Delegate bulk only when reducing won't do.** A long transcript, a large profile, or a sweep across many files can go to a subagent that returns the finding. The subagent costs a cold start and a lossy summary, so reach for it after the cheaper reductions.
- **Size phases and cap scope.** Limit files per phase, and account for the cost of each mechanism before you use it.
