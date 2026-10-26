### Session pickup

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail: a session transcript from this workspace (see **Harness terms** in `../SKILL.md`), a resume note from Pause safely, a `decisions.tsv`, a pushed branch, or the octodo task the work belongs to. Read the last messages first, then scan back for the decision points. Reduce a long transcript with a script, or in a subagent, and keep only the timeline in the main thread (**principle-guard-the-context-window**).
2. Reconstruct operational state: the branch and worktree, what already landed (`git log`, `git diff` against `master`), the open todos, the decisions made, and the task's status in `.octodo/`. The prior trail is authoritative input. Resist the urge to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, and do not redo completed work.
4. Route the remaining work to the matching playbook and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. This playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact (**principle-prove-it-works**). A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
