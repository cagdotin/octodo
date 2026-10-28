# 0009. A recurring task is one folder with a log of occurrences

- Status: accepted
- Date: 2026-10-28

## Decision

- A recurring task is one task folder. It does not create a new task per occurrence.
- Its rule is a frontmatter key (`repeat: every 3 days`), not a separate `config.json`, which
  already means the workspace file.
- Each occurrence is one line in `log.jsonl` in the task folder:
  `{"at":"2026-10-25T09:12:00Z","event":"done"}`.
- The next due date is computed on read from the rule and the log. No scheduler runs to produce
  it.

## Consequences

- Days-since counters reuse the log (a reset is a line), and anniversaries need only a date key.
- A reminder that fires at a set time needs a running process. That waits for the always-on server
  discovery task.
- Under [0001](0001-octodo-is-the-only-writer.md) there is no merge rule for conflicting logs. A
  malformed line is a diagnostic.
