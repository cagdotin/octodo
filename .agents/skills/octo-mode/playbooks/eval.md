### Eval

**You own the experiment design. Plan, blind, run, synthesize.** This playbook needs subagents by design (candidates and a judge that must not see each other), so run it only when the user asks for an eval.

**Blinding rules:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not the meta.
- No chain-eliciting cues. Don't ask the candidate to list which skills or principles it applied. Grade chain-following from what it did, not self-report.
- Sanitize directory names. Use project-shaped names a user might pick.
- Don't tell the candidate other candidates exist.
- The judge can know it's judging but sees outputs by sanitized label only, never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one scale, blind to which set each came from.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only.
2. **Set up sanitized environments.** One working dir per candidate with the variant in place (a copy of the repo or a worktree with the skill change applied). Plant any context an organic task would have.
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Spawn N parallel candidates** in one message. Each works in its own dir with the same prompt. A candidate that produces nothing is a dropout. Note it and proceed. Spread them across model families when your harness allows it.
5. **Spawn one blinded judge** after every candidate finishes. It sees the rubric and the outputs by sanitized label, scores each criterion, and names a winner. Use a different model family from the candidates when you can pick one.
6. **Verify the chain from transcripts, not self-report.** Read each candidate's session transcript (see **Harness terms** in `../SKILL.md`) and check which files it actually opened. Read only this workspace's sessions.
7. **Read every candidate output yourself** end to end. Compare to the judge's verdict. Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and whether to promote the variant.
