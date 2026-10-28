# 0018. The CLI and stdio MCP find the server through server.json, and embed the engine only when none answers

- Status: accepted
- Date: 2026-10-28

## Context

[0002](0002-server-preferred-topology.md) has the CLI and the stdio MCP server use a running server
and run the engine in-process when there is none, and [0004](0004-packages-by-dependency-direction.md)
gives that choice to a `client` package with `connect()`. Neither says how a client finds the server,
what it does when the server is stale or of another version, or how a folder path, which the CLI
and MCP take, reaches an HTTP API whose path named only registered workspace ids. The owner lock
([0003](0003-one-writer-per-workspace.md)) already makes an embedded writer safe next to a server, so
the question of whether to prefer the server at all is open again.

## Decision

### The discovery file

- `startServer` writes `<home>/server.json` once it listens: `{ "url", "pid", "version" }`, the
  `ServerInfo` schema in `@octodo/contract`. It writes through a temporary file and a rename
  (`writeServerInfo` in `engine/src/storage/home.ts`), and on `close()` removes the file only if it
  still names this server's url and pid, so a server that started later keeps its entry. The last
  server to start wins; there is one per machine ([0002](0002-server-preferred-topology.md)).
- Only servers write it. A client never deletes it, even when it is stale: the next server
  overwrites it, and the pid check below ignores it until then.
- `version` is `VERSION` from `@octodo/contract/api`, the contract package's version. `/api/health`,
  the MCP server info and `octo --version` all give the same value.

### `connect()`

`@octodo/client` exports `connect({ home, registry, watch })` and the `Connection` service built from
it. A `Connection` runs any operation of the registry, adds and removes a workspace, and runs
fix-all. Each call picks where it runs:

| `server.json`                                               | The call                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| absent                                                      | runs on the engine in this process                                    |
| names a pid that is not running                             | runs on the engine in this process                                    |
| names a running pid, and the connection to `url` is refused | runs on the engine in this process: nothing listens there             |
| `/api/health` answers with this version and `operations`    | goes to the server over HTTP                                          |
| `/api/health` answers with this version but no `operations` | runs on the engine in this process, as `Capabilities` says            |
| `/api/health` answers with another version                  | fails with `ServerMismatch`, which says to restart or stop the server |
| no answer within 2 s, or an answer octodo does not send     | fails with `ServerUnavailable`, which names the url and pid           |
| the file does not read as `ServerInfo`                      | fails with `StorageError` naming the file                             |

- A connection probes a server once per url and pid and then trusts it, so each later call costs a
  read of `server.json`. A long-running `octo mcp` follows a server that starts or stops; the
  embedded engine is built on the first call that needs it and kept.
- A `workspace` that starts with `.` is made absolute against the client's directory before either
  path runs it, since the server has its own directory.
- The embedded path and the remote path give the same values and errors: the remote one decodes
  each success through the operation's `success` schema and each error body through `wireError`
  back into the engine's tagged error. `octo` prints `--json` through the success schema in both
  modes, so key order is the schema's.
- `read_attachment` over HTTP takes `size` from the bytes, `mediaType` from `Content-Type`, and the
  file's absolute path from `Content-Location`, a `file://` URL the download now sends.

### The workspace in an HTTP path

`:workspace` takes what `Workspaces.open` takes: a registered id, or an absolute folder path in one
percent-encoded segment, meaning the workspace containing it. A relative path is refused with
`InvalidRequest`. `DELETE /api/workspaces/:workspace` still takes an id only. The router's
parameter limit is raised from 100 characters to 12,288, so a folder path fits.

### Surfaces

- The CLI provides `Connection.layer({ home, registry, watch: false })` and runs every operation
  command, `doctor`, `init` and `workspace remove` through it. `octo serve` and `octo skills export`
  do not need it.
- `octo mcp` calls `connect` with `watch: true` and gives `stdioLayer` the registry's operations
  and the connection's `run`. `@octodo/mcp` builds tools from operations and a run function, and
  the HTTP endpoint at `/mcp` gives it the engine's.

## Why

- **Prefer the server, though the lock makes embedding safe.** The lock keeps the files correct
  either way, so the preference is about speed and freshness. The server's cache is warm: at 5,000
  tasks `octo list` takes about 0.5 s through it against 1.0 s embedded, and `octo create` 0.6 to
  0.8 s against 1.8 s, because an embedded command scans every task and a write also walks the
  folder for leftovers. Writes from one process also spare the server a rescan at each lock
  handover (OCT-46), and the web app sees the change as soon as the server writes it.
- **Fall back when nothing listens, report when something does.** A dead pid or a refused
  connection proves there is no server at that address, and because the lock keeps writes safe,
  embedding then costs nothing. A server that hangs, answers garbage or runs another version is
  still there, and the person's open app would drift from what the CLI did, so the client reports
  it instead of writing behind it, as 0002 says.
- **A stdio MCP that is a client, not a protocol bridge.** The task first asked the stdio server to
  relay MCP messages to `/mcp`. That would need rewriting each call that omits `workspace` to the
  stdio server's directory and relaying sessions and notifications. Running the same tools on the
  `Connection` gives the same tool list (it is generated from the same registry) and the same
  results with none of that.
- **The server resolves folders.** Registering every folder a command names would change
  `workspaces.json` and what `workspace list` prints. Resolving in the client would duplicate the
  nearest-`config.json` walk. `/mcp` already took absolute folders, so `/api` taking them adds no
  reach the server did not have ([0010](0010-no-authentication-for-now.md)).
- **One version string.** The contract is what client and server must agree on, so its version is
  the one compared.

## Consequences

- Output is the same in both modes, with one exception. When a hand-made file gets an id, the
  process that read it logs `Assigned HM-51 to ...`. Through a server, that line is in the server's
  log, not on the CLI's stderr.
- `octo show --json` and `octo update --json` list `mentions` after `ready`, the schema's order, as
  MCP and HTTP already did. Before this, the CLI printed the engine's own key order.
- The CLI still loads the engine in server mode: its commands are generated from `makeRegistry`,
  which lives there. Startup, about 0.4 s of module loading, is the same in both modes and limits
  a command on a small workspace.
- Two `startServer` calls on one home leave `server.json` to the later one. A server removed while
  another rewrites the file can, in a narrow window, remove the other's entry; clients then embed,
  which the lock keeps safe.
- The server keeps a handle, and a watcher, for each folder a client names, registered or not.
  Handles are keyed by the folder's real path, so one folder reached by two paths shares one.
- OCT-55: the desktop app reads the same `server.json` to attach, and the server it spawns writes
  it.
