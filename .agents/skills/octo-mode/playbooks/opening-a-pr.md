### Opening a PR

Invoked at the end of every playbook that changes code, when the task asks for commits or a PR. Without that ask, stop at a clean, reviewable working tree and say so.

**Branches.** Trunk is `master`. Branch from it, or from the branch the user names. When parallel agents share one checkout, give each its own git worktree. A dirty branch with unrelated work: stash or patch it out first, never mix it in.

**Commits.** Small and ordered, each one landable, ordered to tell the story (**principle-sequence-verifiable-units**). Amend when the fix belongs in the commit you just made. Make a new commit when it is separable. Commit bodies don't restate the subject. Lefthook formats, lints, and typechecks on commit, and runs `pnpm check` before push. Never skip the hooks to get a commit through. Fix what they report.

**Titles.** Conventional Commits `type(scope): subject`, no trailing period. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`. The scope is the area: `core`, `server`, `mcp`, `cli`, `web`, `desktop`, `site`, `brand`, `agents`. The subject is short, imperative, and names a real symbol when one carries the change, for example `fix(core): keep frontmatter key order when moving a task`.

**Before the PR.** Run **comment-review** over the diff. Write the title, the body, and the commit bodies with **technical-writing** (every layer except Diátaxis), then apply **unslop**.

**Descriptions.** The PR body is a one-minute briefing for a reviewer who has the diff. It says why the change exists, what it leaves out, what it could break, and how you proved it works. Short, simple sentences with few identifiers. Use `##` headings in this order, and drop a section with nothing to say:

- `## Why`: the problem and approach, 1-3 short sentences. Link the octodo task id when there is one.
- `## What changed`: 1-3 short bullets. Name a real symbol or path only when it carries the change.
- `## Scope`: what it covers and what it deliberately leaves out.
- `## Tradeoffs`: only rejected alternatives a reviewer would otherwise ask about.
- `## Blast radius`: 1-2 sentences on who or what it touches and why that is safe or risky. Call out any change to what lands on disk, because people and other tools read those files.
- `## Verification`: 1-3 bullets, each a real run path and its outcome. Perf: one primary number with its unit, `before → after`.

Attach screenshots or a short video when the change is visible. Long logs and lane-by-lane recitals go in a linked artifact, not the body.

**Forge.** GitHub through `gh`. `gh pr create --base <base>` opens it, ready, not draft. Run `gh pr view <number>` before you refer to PR status.

**Size and stacks.** Prefer several narrow PRs to one large one. A stack is a base-branch chain: the root PR targets `master`, each child targets its parent's branch.

**Babysit.** Opening a PR does not start a babysit. Post the URL and keep going. Run the Babysit playbook only when the user asks for it.
