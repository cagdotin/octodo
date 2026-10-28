# 0021. The desktop app attaches to the server, or spawns and supervises one

- Status: accepted
- Date: 2026-10-28

## Context

[0002](0002-server-preferred-topology.md) says the desktop app attaches to a running server or
spawns one as a child, instead of running the server inside Electron's main process. Before this,
a crash in a watcher or parser took the window down, and when `octo serve` held port 4520 the app
started a second server on a random port, which then took `server.json` over from `octo serve`.
[0018](0018-connect-finds-the-server-through-server-json.md) says how a client finds the server and
when it must report a server instead of working behind it. It does not say who restarts a server
that crashes, what the window shows meanwhile, or how a person sees a server the app cannot use.

## Decision

### Attach or spawn

At launch, and whenever its server is gone, the app applies 0018's rules through `findServer(home)`
from `@octodo/client`, the same probe `connect()` uses:

| `server.json`                                                      | The app                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| absent, a dead pid, or a refused connection                        | spawns a server child                                    |
| names a server that answers `/api/health` with this version        | attaches to it, and never stops it                       |
| names a server of another version, one that hangs or answers wrong | shows the problem in the window, with Try Again and Quit |
| does not read as `ServerInfo`                                      | shows the problem in the window, with Try Again and Quit |

- The child is the app's own binary with `ELECTRON_RUN_AS_NODE=1`, running the bundled
  `dist/server.mjs` (`apps/desktop/src/server.ts`), which calls `startServer`. It writes
  `server.json` as any server does, and tells the app over the IPC channel that it listens
  (`{ listening: url }`) or why it could not (`{ failed: code, message }`). It closes cleanly,
  removing its `server.json`, on SIGTERM, SIGINT, or when the IPC channel drops because the app
  died. It listens for these before it starts the server, so an app that dies while its child is
  still starting leaves no server behind.
- A new child listens on `OCTODO_PORT` or 4520 first, and a restarted one on the port of the child
  before it, so the window's origin, and the web app's local storage with it, stays the same. When
  the port is taken, the app probes `server.json` again (another octodo may have just started
  there) and attaches to it, or else spawns the child on any free port.
- An attached server is watched every second: when its process ends, or `server.json` stops naming
  it (a server removes its entry when it closes), the app applies the rules again, and usually
  spawns its own child.

### Restart

- A child that exits without being asked to, or never gets to listen within 20 s, is replaced
  after a backoff: 0.5 s, then 1, 2 and 4 s. A child that ran for 30 s or more counts as healthy,
  so its next crash restarts it at once.
- After five failures in a row the window shows "The octodo server keeps stopping" with the last
  lines the child wrote to stderr, and Try Again and Quit.
- Each restart applies the attach-or-spawn rules again, so a server started meanwhile is used
  rather than a second one.

### The window

- The window loads the web app from the server's own origin, as a browser does with `octo serve`.
  When a new server listens on another origin, the window loads the same route there. In
  development the window loads Vite, and Vite's proxy reads `server.json` at each request, so it
  follows the server the app attached to or spawned.
- Problems are a page in the window, not a native dialog: the person sees what is wrong in the
  app itself, before any window would otherwise exist, and its buttons are links the main process
  catches. Nothing is replaced or stopped without the person.

### Quitting

Quitting stops the child the app spawned (SIGTERM, then SIGKILL after 5 s), so its `server.json`
goes. An attached server keeps running. A quit while the app is still looking for a server spawns
nothing.

### `octo serve`

`octo serve` refuses to start when `server.json` names a server that answers as this version does,
and reports one of another version or one that does not answer, as other clients do. With the
desktop attaching, it was the last way to get two servers on one home.

## Why

- **A child, not the main process.** A crash in the engine now costs a restart of the child, and
  the window stays. The main process keeps only what Electron must do: windows, menus, dialogs.
- **`ELECTRON_RUN_AS_NODE` rather than `utilityProcess`.** The child is plain Node: it gets a
  `disconnect` event when the app dies and can close cleanly, and the same file runs under Node in
  tests. The cost: it needs Electron's `RunAsNode` fuse on, which electron-builder leaves on. If the
  app is ever hardened with that fuse off, the child moves to `utilityProcess.fork`, which takes the
  same file with `process.parentPort` instead of `process.send`.
- **The window on the server's origin, not an origin passed over IPC.** The task first had the
  renderer get the server's origin over IPC and call it. A page on another origin calling the
  server needs CORS headers on it, which would let any web page read tasks. Loading the server's
  own origin keeps every request same-origin and the web app unchanged. A stable port keeps the
  origin stable across restarts.
- **Vite follows `server.json`.** In development the app may attach to `octo serve` on any port, or
  its child may fall back to a free one; a fixed proxy target would point at nothing. Reading
  `server.json` is how every other client finds the server (0018). `OCTODO_API_PORT` still pins it.
- **Report, never replace.** 0018's reasons hold: a server of another version, or one that hangs,
  is still running, and a second server would leave the two drifting. Only the person knows
  whether to stop it.

## Consequences

- One server per home in the normal case: the app, `octo serve` and every CLI and MCP client share
  it, and the app starts one only when none runs.
- When attached, the window shows the web app the attached server serves. `octo serve` serves the
  build in `apps/web/dist` next to its sources, or `--web-dir`; one started without a web build
  shows the server's 404 in the app window.
- A SIGKILLed child leaves its `server.json` behind; clients treat it as stale through the pid
  check, and the next server overwrites it.
- Packaging is [0024](0024-the-desktop-app-is-packaged-with-electron-builder.md): the child runs
  `dist/server.mjs` from inside `app.asar`, and the `RunAsNode` fuse stays on for it.
