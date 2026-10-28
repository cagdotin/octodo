---
id: OCT-87
title: With a server running, `octo recurring log <id>` and `octo counter reset <id>` fail with "Expected object"
status: todo
priority: high
tags:
  - cli
  - mcp
  - plugins
  - bug
created: 2026-10-28T15:04:59.226Z
order: aY
---

## Problem

Found in the CLI end-to-end run of [[OCT-61]]. With no server, `octo recurring log PR-81` logs the occurrence. With `octo serve` running for the same home, the same command prints `Expected object` and exits 1, and so does `octo counter reset <id>`. They are the commands' main use (done now, reset now). Errors come out wrong too: `octo recurring log PR-1` on a plain task says `Expected object` instead of `PR-1 is not a task of the recurring kind`. The stdio MCP server goes through the same client, so an agent's `log_occurrence` or counter reset without `at` fails the same way while the app runs.

Cause: `requestOf` in `packages/client/src/remote.ts` leaves out the payload when no body field is set (`Object.keys(rest).length === 0 ? {} : ...`). The server's HttpApi then decodes a missing body against the payload struct and answers `400 {"_tag":"InvalidRequest","message":"Expected object"}`. The plugins' web halves send `payload: {}`, so the app works.

```sh
curl -s -X POST http://127.0.0.1:<port>/api/workspaces/<ws>/recurring/PR-81/occurrences
# {"_tag":"InvalidRequest","message":"Expected object"}
curl -s -X POST -H 'content-type: application/json' -d '{}' .../recurring/PR-81/occurrences
# 200
```

## Repro

```sh
H=$(mktemp -d); W=$(mktemp -d)
OCTODO_HOME=$H bin/octo init $W --preset chores --key CH
OCTODO_HOME=$H bin/octo recurring create "Water plants" -r "every 3 days" -w $W   # CH-1
OCTODO_HOME=$H bin/octo recurring log CH-1 -w $W        # works, no server
OCTODO_HOME=$H bin/octo serve --port <spare> &
OCTODO_HOME=$H bin/octo recurring log CH-1 -w $W        # Expected object, exit 1
```

## Done when

- Every operation whose body fields are all optional works over HTTP with none set, from the CLI and stdio MCP alike: send `{}` for a method that has a payload, or have the server read a missing body as `{}`.
- The every-surface parity test covers an operation called with only its path parameters.
