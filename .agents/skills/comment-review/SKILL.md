---
name: comment-review
description: "Review the comments in a diff before review. The code is the documentation, so each comment is a signal: refactor the code until the comment is unnecessary, or delete it. Keeps one-line doc comments on public API where types don't say enough, and the reasons for real edge cases. Use for /comment-review, or before opening a PR."
disable-model-invocation: true
---

# Comment review

The rule is in the Comments section of `../octo-mode/SKILL.md`: the code is the documentation. A comment means the code is too complicated or handles an edge case. This pass treats every comment in scope as a refactoring opportunity. Do it yourself, over the diff.

## Scope

Use the caller's files or diff. Otherwise use the diff against `master`, including the working tree. Comments in untouched code are out of scope, unless the diff made them wrong.

## Steps

For each comment in scope, take the first step that applies.

1. **Wrong or stale.** The diff made it false, or it names a renamed symbol or a moved file. Delete it, or fix it if it passes the later steps.
2. **Noise.** Narration of the next line, commented-out code, changelog comments ("now uses X"), phase banners in tests, a `TODO` with no task. Delete it. A `TODO` worth keeping becomes an octodo task instead.
3. **The code could say it.** The comment explains what the code does. Make the code say it instead: rename a variable or function, extract a named function, introduce a type or schema, or restructure so the case can't happen (**principle-model-the-domain**). Then delete the comment. If the refactor is larger than the diff, keep the comment, and report the refactor as open.
4. **A public API doc comment.** A one-line doc comment on an exported function, service, or schema stays only when its name and types don't already say what it does. Cut it to one line. Delete it when the signature already says it.
5. **An edge case or outside constraint.** A platform, sync-tool, or library quirk, or an edge case the code must handle. Check that the reason is real. Run **how** or **why** if it isn't obvious. If the cause is in our own code, fix the cause and delete the comment (**principle-fix-root-causes**). If the cause is outside our control, keep the comment, cut it to the reason, and name the cause.
6. **A "do not" warning.** `do not remove`, `must stay before X`, `keep in sync with Y`. This is a rule nothing enforces. Offer the cheapest check that would enforce it: a type, a test, an assertion, or a lint. Encode it when the user approves, then delete the comment. Without approval, keep it.

Then check the diff's suppressions. Each `oxlint-disable`, `@ts-expect-error`, or `@ts-ignore` needs a reason on the same line. If the rule protects correctness, fix the code instead.

Don't add comments to make code readable. Make the code readable.

## Report

Counts of comments deleted, refactored away, and kept, with the reason for each one kept. Also report the refactors left open, the encodings offered or made, and any suppression kept with its reason.
