# Where the octo skills come from

A reference for people maintaining the skills. No skill or agent instruction points here.

Most skills in `.agents/skills/` are a fork of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, taken at `cursor/plugins@99b609a` (pstack 0.15.32). They were adapted for octodo and rewritten to work in any harness that reads `.agents/skills/`. `shadcn` and `octodo` are not part of the fork, and `improve-codebase-architecture` comes from elsewhere (see below).

## What changed

- **Renamed.** `poteto-mode` is `octo-mode`, and `poteto-help` is `octo-help`. There is no `poteto-agent`. A subagent gets the path to `octo-mode/SKILL.md` in its brief.
- **Harness-neutral.** Skills say what to do, not which Cursor tool to call. `octo-mode` maps the generic terms (subagent, todo list, ask the user, loop, session transcripts) in its Harness terms section. Skills reference each other by relative path, which works in every harness.
- **Inline by default.** `how`, `why`, `architect`, `interrogate`, `reflect`, and the playbooks do the work themselves. They spawn subagents only for parallel slices, bulk the main thread only needs the conclusion of, or an unanchored reviewer. The Eval playbook still fans out, and runs only when asked.
- **No model roles.** `setup-pstack` and the `pstack-models` rule are gone. Where independence matters, a skill asks for a different model family when the harness allows a choice.
- **Comments.** `no-comments` and the Comment Sicko agent are replaced by `comment-review`, built on the rule that the code is the documentation. The rule itself is in the Comments section of `octo-mode` and in `AGENTS.md`.
- **octodo evidence.** `why` searches git and `gh`, the `.octodo/` tasks and their history, `docs/` and `AGENTS.md`, and past agent sessions. The Linear, Notion, Slack, Datadog, Sentry, and Databricks playbooks are gone, because octodo uses none of them.
- **octodo verification.** The playbooks prove behavior on the CLI, API, web, desktop, and the files on disk, against a scratch `OCTODO_HOME`. They don't use the `control-ui` and `control-cli` skills.
- **Repo specifics.** `typescript-best-practices` covers Effect v4, Schema, and erasable-only syntax. Babysit and Opening a PR use `gh`, `master`, lefthook, and this repo's commit scopes. Follow-ups and backlog items become octodo tasks.

## Left out

These are gone, and each can come back:

- `arena` and `swarm`: parallel candidates and parallel workers. Not needed here.
- `setup-pstack`: per-role model config for Cursor.
- `make-bot-ui`: Grok Bot webhook pages.
- `ketchup-video`: the video version of `ketchup`.
- `statechart`: Mermaid statecharts from TLA+ models. About 6k lines of scripts, worth adding with the first formal verification skill.
- Playbooks: Shipping, Orchestrate, Autopilot-full, Autopilot-stack, Worktree cleanup. They depend on Cursor cloud agents, Bugbot, and bundled Bun scripts (`watch-pr`, `orch`, `check-plan`).
- The `benny` automation pack and the pstack guide in `docs/guide/`.

## Not set up yet

- Tracing. The Perf issue and forensics playbooks use `node --cpu-prof` and DevTools for now. Effect spans and an exporter would make every perf task cheaper.
- A `verify-octodo` skill. Run `/create-verification-skill` to make one. Until then, `octo-mode` lists how to drive each surface.

## improve-codebase-architecture

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture) at `5beb35b`, MIT licensed, Copyright (c) 2026 Matt Pocock (same license text as below).

- The HTML report (`HTML-REPORT.md`) is gone. The skill replies with a structured markdown message.
- Its sibling skills are folded in: `codebase-design` and its `DEEPENING.md` into `references/vocabulary.md`, `domain-modeling` and its formats into `references/domain-records.md`, and `grilling` into step 3.
- Design it twice uses `architect` Phase B, inline, instead of three or more parallel subagents. Exploration is inline too.
- The glossary is `docs/glossary.md` rather than a root `GLOSSARY.md`. Both it and `docs/adr/` are created lazily.

## License

pstack is MIT licensed:

```
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
