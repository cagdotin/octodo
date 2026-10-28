# 0001. octodo's own clients are the only writers of `.octodo/`

- Status: accepted
- Date: 2026-10-28

## Context

The early design treated iCloud, git and hand edits as normal writers of the files. That premise
produced conflict-copy rules (`HM-3-paint 2`), cross-process id claims and plans for merging
`log.jsonl` files. octodo is a single-user app on one machine. Covering every way an outside tool
can change the files has no end and is not what the product is for.

## Decision

- The files are the single source of truth. Nothing replaces them: no database, no index that
  outranks them.
- octodo's clients (the app, the web UI, the CLI, the MCP server) are the only supported way to
  change them.
- A hand edit, a sync tool or a merge that breaks the format is outside the contract. The reader
  stays strict: every schema violation becomes a diagnostic the user can see. octodo does not try
  to repair, merge or reconcile such edits beyond the fixes it already offers.
- No collaborative editing, no offline sync and no conflict resolution.

## Consequences

- Each plugin and feature brings its own validators (rows in `PROBLEMS`). Validation, not
  reconciliation, is how octodo handles files it did not write.
- Code that exists only for outside writers can go: conflict-copy precedence becomes a plain
  diagnostic, and id claims give way to one owner lock ([0003](0003-one-writer-per-workspace.md)).
- Atomic writes (temporary sibling, then rename) stay, because they protect against crashes.
- The watcher stays, so a hand edit is noticed and reported.
