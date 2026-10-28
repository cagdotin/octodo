# 0003. One writer per workspace, through an owner lock

- Status: accepted
- Date: 2026-10-28

## Context

Several octodo processes could write one workspace at once, so every new id was reserved through
`.octodo/.claim-<ID>`. A `.pending-id` marker let readers agree on the id of a file that was being
written, and the id walk had to read fresh from disk to see other processes' creates. OCT-43 lists
the risks of that walk. With [0001](0001-octodo-is-the-only-writer.md) and
[0002](0002-server-preferred-topology.md), only one octodo process needs to write at a time.

## Decision

- One process at a time holds a workspace's owner lock, and only the holder writes.
- Other clients go through the holder (the server), or wait for the lock when they embed the
  engine.
- The lock must be released by the OS when its holder dies, even on SIGKILL. t3code uses an
  exclusive SQLite transaction and executor an exclusive SQLite lock on a separate file. Node's
  built-in `node:sqlite` makes the same approach available without a dependency.
- `.claim-<ID>`, `.pending-id` and the fresh id walk are removed. The holder assigns ids from its
  own state.

## Mechanism (OCT-46)

- The lock is an exclusive transaction (`BEGIN EXCLUSIVE`, `busy_timeout` 0) on
  `.octodo/.owner-lock`, opened with `node:sqlite` (`packages/core/src/storage/owner-lock.ts`). It
  lives in `.octodo/` rather than in `<home>`, so every process finds the same file whatever its
  `OCTODO_HOME` or the path it opened the folder by, and moving the folder moves the lock. It is a
  dot name, so scans, the watcher and attachments ignore it, and `.gitignore` lists it.
- A process holds it for each write (a create, an edit, a fix, giving ids to hand-made files), not
  for its lifetime. Several embedded engines on one workspace are normal under 0002: each agent's
  stdio MCP server runs its own when no server is up. A lifetime lock would let only the first of
  them write. A server could still hold the lock for longer later; the API does not change.
- A process that finds the lock taken retries with a short backoff (1 to 50 ms) for 10 seconds,
  then fails the write with "Another octodo process is writing this workspace". Reads never take
  the lock. Retrying in Effect, rather than SQLite's busy timeout, keeps a waiting server's event
  loop free.
- The lock's one row names the last holder. A process that takes the lock from another holder
  first writes its own name into the row and commits, then takes the lock again. So a holder that
  dies during its writes still leaves the row naming it. Whenever the row names someone else, the
  new holder forgets its cache (the next read rescans), removes the temporary files a crashed
  write left (no write that owns one can still be running) and adds missing `.gitignore` lines.
  While one process keeps writing, a hold costs one transaction and no rescan.
- The holder assigns the next id from its scan's highest id on disk, and never hands out a number
  twice in one process.

## Evidence

Prototypes in a scratch folder, Node 26.10.0 on macOS 26.5.2:

| Lock                            | Second process while held            | After the holder gets SIGKILL                    |
| ------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `node:sqlite` `BEGIN EXCLUSIVE` | `database is locked` (SQLITE_BUSY 5) | taken at once                                    |
| `open(path, "wx")` with a pid   | `EEXIST`                             | still `EEXIST`: needs a pid check, as claims did |
| Unix socket `listen(path)`      | `EADDRINUSE`                         | still `EADDRINUSE`: the socket file stays        |
| `flock`                         | not in Node's `fs`                   |                                                  |

- A second connection in the same process gets SQLITE_BUSY too, so two workspaces opened in one
  process also take turns.
- Even opening statements (`PRAGMA`, `CREATE TABLE`) fail while another connection holds the
  lock, so the table is created inside the exclusive transaction.
- A hold by the same holder costs about 12 µs. Taking the lock over from another holder (two
  commits) costs about 0.2 to 0.3 ms.
- Electron 45 (Node 24.22) ships `node:sqlite` with SQLite 3.53.4, so the desktop app's
  in-process server can take the lock.
- `ids.test.ts` races real processes on the lock: two `create:15` runs give HM-1 to HM-30 once
  each; a create waits while a paused holder holds the lock and writes HM-2 after it; a holder
  killed with SIGKILL mid-write leaves the lock free at once.

## Consequences

- Hand-made files without an id get one from the holder under the lock, on the first read that
  sees them. A read that cannot take the lock in time reports them as `missing-id`.
- The riskiest step of the core refactor (a fresh, uncached id walk) is gone.
- A task file that appears between two holds by another route (a sync tool, a hand copy) can still
  share an id with a new task; that is a `duplicate-id` diagnostic, outside the contract of 0001.
- Leftover `.claim-*` and `.pending-id` files from before are not removed. Nothing was released
  with them, scans ignore dot names, and they are harmless.
