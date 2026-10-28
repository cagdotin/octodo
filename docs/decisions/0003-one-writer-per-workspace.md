# 0003. One writer per workspace, through an owner lock

- Status: accepted, not built
- Date: 2026-10-28

## Context

Several octodo processes can write one workspace at once today, so every new id is reserved
through `.octodo/.claim-<ID>`. A `.pending-id` marker lets readers agree on the id of a file that
is being written, and the id walk must read fresh from disk to see other processes' creates.
OCT-43 lists the risks of that walk. With [0001](0001-octodo-is-the-only-writer.md) and
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

## Consequences

- Hand-made files without an id get one from the holder under the lock, on the first read.
- The riskiest step of the core refactor (a fresh, uncached id walk) disappears.
