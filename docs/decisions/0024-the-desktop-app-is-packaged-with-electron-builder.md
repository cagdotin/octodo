# 0024. The desktop app is packaged with electron-builder, and its server child runs from app.asar

- Status: accepted, amended by 0029
- Date: 2026-10-28

## Context

[0021](0021-the-desktop-app-attaches-to-or-spawns-the-server.md) runs the server as a child: the
app's own binary with `ELECTRON_RUN_AS_NODE=1`, running the bundled `dist/server.mjs`. It left
packaging open, and said `server.mjs` belonged in `asarUnpack` until someone checked whether
Electron's Node mode loads an ES module from inside `app.asar`. Only a hand-assembled, non-asar
layout had been run.

## Decision

`pnpm package` builds the web app and the desktop bundles, then runs electron-builder for macOS.
The configuration is the `build` field of `apps/desktop/package.json`.

- **Contents.** `app.asar` holds only `package.json` and `dist/` (`main.mjs`, `server.mjs`,
  `preload.cjs`). tsdown bundles every dependency into those files, so the workspace packages and
  `effect` are devDependencies and the app ships no `node_modules`; `npmRebuild` is off, as there
  is nothing native to rebuild. The web build is an extra resource at `Resources/web`, where
  `main.ts` looks when `app.isPackaged`.
- **No `asarUnpack`.** The child runs `app.asar/dist/server.mjs` as it is. Checked on the packaged
  app: the child listens, serves `Resources/web`, writes and removes `server.json`, and answers
  `/api/health` in about 0.16 s from launch, the same as the file outside the archive.
- **Fuses.** Set at build time by electron-builder (`electronFuses`):

  | Fuse                                    | Value | Why                                                                                                   |
  | --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
  | `RunAsNode`                             | on    | The server child is `ELECTRON_RUN_AS_NODE=1` (0021). Turning it off means moving to `utilityProcess`. |
  | `EnableNodeOptionsEnvironmentVariable`  | off   | Nothing sets `NODE_OPTIONS`; off, it cannot inject code into the app or its child.                    |
  | `EnableNodeCliInspectArguments`         | off   | The child is spawned without `--inspect`; off, nobody can attach a debugger to it through arguments.  |
  | `EnableEmbeddedAsarIntegrityValidation` | on    | The main process and the child run only code from `app.asar`, which the hash in `Info.plist` covers.  |
  | `OnlyLoadAppFromAsar`                   | on    | The app is never loaded from a loose `Resources/app` folder that someone could drop in.               |
  | `GrantFileProtocolExtraPrivileges`      | off   | The window loads `http://127.0.0.1` and a `data:` problem page, never `file://`.                      |
  | `EnableCookieEncryption`                | off   | No cookies to protect; on macOS it keys the store in the Keychain, which prompts after each rebuild.  |
  | `LoadBrowserProcessSpecificV8Snapshot`  | off   | Electron's default; the app has no custom snapshot.                                                   |

- **Signing.** Ad-hoc (`identity: "-"`), with the hardened runtime and electron-builder's default
  entitlements, and no notarization. The build needs no certificate; it is for this computer,
  not for distribution.
- **Targets.** `dmg` and `zip` for the host's architecture, in `apps/desktop/release/`.
  `electron-builder --mac --dir` builds only the `.app`.

## Why

- **electron-builder** writes the fuses, the asar integrity hash, the icon and the signature in
  one step, which the hand-assembled layout did by hand or not at all.
- **The child in asar** keeps `OnlyLoadAppFromAsar` and the integrity check meaningful: an
  unpacked `server.mjs` would run outside the hash, so the code the child runs could change without
  the app noticing. The web build in `Resources/web` is outside the hash; the bundle's code
  signature seals it, as it does every resource.
- **The fuses** are off wherever the app does not use what they allow. `RunAsNode` stays on
  because the child needs it; it is the one way left to run the binary as plain Node.

## Consequences

- The app the build makes is unsigned for distribution: Gatekeeper blocks it on another Mac until
  it is signed with a Developer ID and notarized, which needs a certificate and its own task.
  [0029](0029-the-desktop-app-updates-itself-from-github-releases.md) publishes these builds anyway
  and updates them in place; a first download is allowed once by hand.
- The first `pnpm package` downloads Electron (unless cached), and for the dmg, 7-Zip and
  dmgbuild; later builds run from electron-builder's cache.
- Windows and Linux targets are not configured.
