/**
 * Keeps the app up to date (decision 0029): checks its build's channel soon after launch and then
 * every hour, downloads a newer release in the background, and installs it when the person asks.
 */
import {
  channelOf,
  findUpdate,
  install,
  removeFolder,
  removeStaged,
  stage,
  UNRELEASED,
  updatableBundle,
} from "@octodo/client/release";
import { app } from "electron";
import { dirname } from "node:path";

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 60 * 60_000;

/** A release downloaded and unpacked next to the app, waiting for the person to restart. */
interface Ready {
  readonly version: string;
  readonly staged: string;
}

export interface Updates {
  /** The version waiting to be installed, or null. */
  readonly ready: () => string | null;
  /** Swaps the app for the waiting version and restarts into it. */
  readonly install: () => Promise<void>;
}

/** Starts checking, unless this build cannot update itself; calls `onReady` with each new version. */
export const startUpdates = async (onReady: (version: string) => void): Promise<Updates> => {
  const version = app.getVersion();
  const bundle = await updatableBundle(process.execPath);
  if (!app.isPackaged || version === UNRELEASED || bundle === undefined)
    return { ready: () => null, install: () => Promise.reject(new Error("Nothing to install.")) };

  await removeStaged(bundle).catch((error) =>
    console.error(`Removing an earlier update failed: ${String(error)}`),
  );
  let ready: Ready | undefined;
  let checking = false;

  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const release = await findUpdate(ready?.version ?? version, channelOf(version));
      if (release === null) return;
      const staged = await stage(release, bundle);
      if (ready !== undefined) await removeFolder(dirname(ready.staged));
      ready = { version: release.version, staged };
      onReady(release.version);
    } catch (error) {
      console.error(`Checking for an update failed: ${String(error)}`);
    } finally {
      checking = false;
    }
  };

  setTimeout(() => void check(), FIRST_CHECK_MS);
  setInterval(() => void check(), CHECK_EVERY_MS);

  return {
    ready: () => ready?.version ?? null,
    install: async () => {
      if (ready === undefined) throw new Error("Nothing to install.");
      await install(ready.staged, bundle);
      app.relaunch();
      app.quit();
    },
  };
};
