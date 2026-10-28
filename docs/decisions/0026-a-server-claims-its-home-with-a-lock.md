# 0026. A server claims its home with a lock, so one runs per home

- Status: accepted
- Date: 2026-10-28

## Context

`docs/architecture.md` said `octo serve` refuses to start while `server.json` names a server that
answers, so a home has one server. The check ran before the server listened, and
[0018](0018-connect-finds-the-server-through-server-json.md) let the last server to write
`server.json` win. Two `octo serve` started together both passed the check, both listened, and the
later one took `server.json`: the CLI and the app then followed one server while the other kept a
warm cache and a watcher of its own.

The claim has to be atomic, and a claim left by a dead server must not block the next one, which
0018 already gave a stale `server.json` (a dead pid, or nothing listening).

## Decision

| Option                                                                | For                                                                                         | Against                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **An exclusive SQLite transaction on `<home>/.server-lock`** (chosen) | Atomic, and the OS releases it when its holder dies, even on SIGKILL, as the owner lock is. | One more file in the home, and a SQLite handle in the server.                                                        |
| Create `server.json` exclusively (`link` of a full temporary file)    | No new file.                                                                                | A stale file has to be removed first, and two servers that both find it stale can each remove the other's fresh one. |
| Write `server.json`, then read it back                                | One line.                                                                                   | Not atomic: both can write, then both read their own entry before the other writes.                                  |

- `startServer` takes the lock before it listens, with no wait, and holds it until `close()`. When
  another process holds it, `startServer` rejects with `HomeTaken` (`code` `OCTODO_HOME_TAKEN`),
  and `octo serve` prints its message and exits 1.
- `octo serve` still checks `server.json` first, so a running server's url and pid are named, and a
  server of another version, which may not take the lock, is refused too.
- `server.json` keeps 0018's shape and rules: written once the server listens, removed on close
  when it still names this server. A stale file is overwritten by the next server, which gets the
  lock because its writer is gone.

## Consequences

- Two `startServer` calls on one home, in one process or two, run one server; the other is refused.
  0018's note that the later one keeps `server.json` no longer applies.
- A home has a `.server-lock` file next to `workspaces.json` and `server.json`. Nothing else reads
  it.
- The desktop app's child reports `OCTODO_HOME_TAKEN` as a failure to start, not as a busy port;
  it meets it only when another server starts between its check of `server.json` and its spawn.
