### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist someone runs box by box and the user audits from the evidence.** The plan is the deliverable. Do not implement.

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Settle open questions by prototype before you write. Run `prototype.md` for each. Keep the scratch path and the screenshots for the appendix. Ask the user only about a product or preference call that no run can settle, and give options (**principle-never-block-on-the-human**).
3. Explore what the plan touches. Run **how** over each subsystem. Each phase needs file pointers, conventions, test commands, and entry points.
4. Write the plan with the skeleton below. Unless the user names a path, put it in the body of an octodo task for the program, plus one task per PR that the plan names by id, so progress lives in `.octodo/` next to the code. One PR is one change with its own evidence (**principle-sequence-verifiable-units**).
5. Write under **technical-writing**, then **unslop**. The body is a how-to. Appendices hold explanation and reference. Each heading states the task or the finding.
6. Hand back. Post the plan's location, then stop. Execution starts on the user's explicit go.

**Verification.** Tests alone are not sufficient. A PR is verified only when its unit and live boxes are checked, plus its perf box when it has one (**principle-prove-it-works**). The live block drives the real surface (see **Verify on the real surface** in `../SKILL.md`), with a concrete scenario, the evidence it saves, and its pass predicate. The perf block names the metric, the probe, the baseline on `master` measured first, and the number that fails.

```markdown
# <Program> plan

<Under ten lines. What changes, for whom, the rule the program enforces, and the PRs in order.>

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists: a file, a log line, a screenshot, a test run, or a commit.

## <Task as a verb phrase> (<PR id>)

**Depends on.** <PR id, or none.>

**Files.**

- [ ] Edit `<path>`.

**Build.**

- [ ] <One change. Name the symbol and the file.>

**You see.**

- [ ] <One observable result: a screen state, a CLI output, the file on disk.>

**Verify, unit.**

- [ ] <Test file and the case it gains.> Run `<command>`.

**Verify, live.**

- [ ] <Scenario on the real surface.> Save `<evidence>`. Pass when <predicate>.

**Verify, perf.** <Only when the PR can move a number.>

- [ ] Metric, probe, baseline on `master`, and the number that fails.

## Appendix A. Prototype evidence

<Each open question a prototype answered, with the artifact. Each question that stays unproven.>

## Appendix B. Alternatives rejected

<Each approach weighed and why it lost.>

## Appendix C. Risks

<Each risk with the PR it lands in and what to watch.>
```

**Reply:** the plan's location, the PRs with their dependencies, what the prototypes proved and what stays unproven.
