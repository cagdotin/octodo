# 0029. The desktop app updates itself from GitHub releases, on a nightly and a stable channel

- Status: accepted
- Date: 2026-10-29

## Context

[0024](0024-the-desktop-app-is-packaged-with-electron-builder.md) packages the app ad-hoc signed,
for the computer that built it. octodo is now open source, and its users, its author first, need
a build after every merge and an app that offers it without a trip to a download page.

The usual tool, `electron-updater` (what t3code runs), installs an update only when it is signed
with the same Apple Developer ID as the running app. An ad-hoc signature names no developer, so it
refuses. A prototype checked the alternative: an ad-hoc signed app in `/Applications` downloaded
its successor with `fetch`, unpacked it, swapped the two folders and restarted into it. macOS
marks only what a browser downloads as quarantined, so Gatekeeper never stepped in, and a workspace
under `~/Documents` stayed readable after the restart.

## Decision

- **Channels.** Every push to master publishes a nightly: a GitHub prerelease
  `v0.4.0-nightly.<day>.<run>`, numbered as a preview of the release after the newest stable tag.
  A newer push cancels a nightly still building. A stable release `v0.4.0` is published from
  Actions > Stable > Run workflow, which releases the newest nightly's commit as the version it
  previews, or from a pushed `v0.4.0` tag. `scripts/release.ts` holds the steps the workflows
  share: the version, the feed file and pruning old nightlies (ten are kept). electron-builder's own
  publishing is off (`"publish": null`): left on, it sees `GH_TOKEN` in CI and fails building an
  update manifest nothing reads.
- **Feeds.** A feed is a JSON file naming a release: `{ version, url, sha256 }`. `stable.json`
  rides in each stable release and is read through GitHub's `releases/latest/download/`, which
  skips prereleases. `nightly.json` is replaced on a release named `nightly` after each nightly is
  published. Releases go up as drafts and are published once their files are up, so a feed never
  names a zip that is not there yet.
- **The channel is the build's.** A version with `-nightly.` is on the nightly channel and reads
  both feeds, taking the newer, so it lands on each stable release; anything else reads only the
  stable feed. Nothing stores a channel. `octo upgrade --channel <name>` moves to the other one.
  `0.0.0`, the version of a local `pnpm package`, never updates.
- **The app.** `apps/desktop/src/updates.ts` checks 10 s after launch and then hourly. It
  downloads a newer release next to the app, in `.octodo-update-*`, checks its sha256 and unpacks
  it with `ditto`. The sidebar then shows an Update button; a click swaps the folders and restarts.
  The next launch deletes what the update left. An app that cannot write its own folder, such as a
  download macOS translocated, does not check. `packages/client/src/release.ts` holds the steps
  the app and `octo upgrade` share.
- **The CLI ships in the app.** `Contents/Resources/bin/octo` runs the app's binary as Node on its
  bundled `cli.mjs`, so one update moves the app, the CLI and `octo mcp` together and they always
  answer as one version. `octo upgrade` updates the app it belongs to: it downloads the release,
  quits a running app with SIGTERM, swaps the folders and opens the app again. An app installed in
  `/Applications` or `~/Applications` links `~/.local/bin/octo` to its `octo` on launch
  (`octo-link.ts`), unless an octo that works is already there, such as a checkout's `bin/octo`.
- **macOS on arm64 only.** The builds run on `macos-15`, an Apple Silicon runner.

## Why

- **No paid signing yet.** The swap needs only a writable folder, and the prototype showed macOS
  leaves a self-downloaded app alone. A Developer ID later removes the one prompt left, on the
  first download, and could bring back `electron-updater`; the channels and feeds stay as they are.
- **The channel follows the build** because the build already says what it is. A stored setting
  could disagree with the build, and nobody has asked to switch from the app.
- **A feed of our own** instead of electron-builder's `latest-mac.yml`: the app reads three fields,
  and GitHub has no link to the newest prerelease, so the nightly feed needs its own release
  either way.
- **Cancel, don't queue, nightlies.** A run of merges ends in one build of the last commit. A
  queued stable release is never cancelled.

## Consequences

- A first download is quarantined: macOS says it cannot verify octodo, and the person allows it
  once in System Settings > Privacy & Security. Updates after that need nothing.
- Electron's `fs` treats an `app.asar` as a folder and cannot delete one, so the app and its `octo`
  delete old app folders with `rm -rf`.
- A running dev app (`pnpm dev`) holds the single-instance lock of the default user data folder,
  so an installed app opened next to it quits at once.
- Intel Macs, Windows and Linux get no builds.
- A plain `bin/octo` from a checkout has `octo upgrade`, which says to `git pull` instead.
