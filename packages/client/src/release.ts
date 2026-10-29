/**
 * Updating the installed macOS app from the releases GitHub publishes (decision 0029). The desktop
 * app and `octo upgrade` share these steps: find a newer release on the build's channel, download
 * and unpack it next to the app, then swap the two folders.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, mkdtemp, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

export type Channel = "stable" | "nightly";

/** What a channel's feed file says: its newest build and the zip of its `.app`. */
export interface Release {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
}

const RELEASES = "https://github.com/cagdotin/octodo/releases";

/** GitHub's `latest` skips prereleases, so it always names the newest stable release. */
const FEEDS: Record<Channel, string> = {
  stable: `${RELEASES}/latest/download/stable.json`,
  nightly: `${RELEASES}/download/nightly/nightly.json`,
};

/** `OCTODO_RELEASES` points both feeds at `<url>/<channel>.json`, for trying an update locally. */
const feedUrl = (channel: Channel) => {
  const base = process.env["OCTODO_RELEASES"];
  return base === undefined ? FEEDS[channel] : `${base}/${channel}.json`;
};

/** Builds of a local `pnpm package` keep this version; no feed is theirs, so they never update. */
export const UNRELEASED = "0.0.0";

export const channelOf = (version: string): Channel =>
  version.includes("-nightly.") ? "nightly" : "stable";

const parse = (version: string) => {
  const [core = "", ...pre] = version.split("-");
  return { core: core.split(".").map(Number), pre: pre.join("-").split(".").filter(Boolean) };
};

const compareIdentifiers = (a: string, b: string) => {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a) !== numeric.test(b)) return numeric.test(a) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Semantic version precedence: negative when `a` is older than `b`. */
export const compareVersions = (a: string, b: string): number => {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const difference = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const difference = compareIdentifiers(left.pre[i]!, right.pre[i]!);
    if (difference !== 0) return difference;
  }
  return left.pre.length - right.pre.length;
};

const isRelease = (value: unknown): value is Release =>
  typeof value === "object" &&
  value !== null &&
  ["version", "url", "sha256"].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "string",
  );

/** A channel's newest release, or null while the channel has none yet. */
const latest = async (channel: Channel): Promise<Release | null> => {
  const response = await fetch(feedUrl(channel));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The ${channel} feed answered ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRelease(body)) throw new Error(`The ${channel} feed does not name a release.`);
  return body;
};

/**
 * The newest release newer than `current` on `channel`, or null. A nightly install takes stable
 * releases too, so it lands on each one when it ships.
 */
export const findUpdate = async (current: string, channel: Channel): Promise<Release | null> => {
  const channels: ReadonlyArray<Channel> =
    channel === "nightly" ? ["stable", "nightly"] : ["stable"];
  const found = (await Promise.all(channels.map(latest))).filter((release) => release !== null);
  const newest = found.reduce<Release | null>(
    (best, release) =>
      best === null || compareVersions(release.version, best.version) > 0 ? release : best,
    null,
  );
  return newest !== null && compareVersions(newest.version, current) > 0 ? newest : null;
};

/** Unpacked updates wait in a folder with this prefix next to the app, on the same volume. */
const STAGING = ".octodo-update-";

/**
 * The `.app` folder a process of the app runs from, when the app can replace it: undefined when
 * it is not packaged in one, or sits where this user cannot write, such as a download macOS
 * translocated to a read-only folder.
 */
export const updatableBundle = async (execPath: string): Promise<string | undefined> => {
  const bundle = resolve(execPath, "../../..");
  if (!bundle.endsWith(".app")) return undefined;
  try {
    await access(dirname(bundle), constants.W_OK);
    await access(bundle, constants.W_OK);
    return bundle;
  } catch {
    return undefined;
  }
};

const run = promisify(execFile);

/**
 * Deletes a folder that may hold an app. Electron's `fs`, which the app and its `octo` run on,
 * treats each `app.asar` as a folder and cannot delete it; rm(1) can.
 */
export const removeFolder = (folder: string) => run("rm", ["-rf", folder]);

/** Downloads `release` into a new staging folder next to `bundle`; resolves to the unpacked app. */
export const stage = async (release: Release, bundle: string): Promise<string> => {
  const folder = await mkdtemp(join(dirname(bundle), STAGING));
  try {
    const response = await fetch(release.url);
    if (!response.ok) throw new Error(`Downloading ${release.url} answered ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== release.sha256)
      throw new Error(`The download of ${release.version} is damaged (sha256 ${sha256}).`);
    const zip = join(folder, "update.zip");
    await writeFile(zip, bytes);
    // ditto keeps the symlinks and signatures inside the app's frameworks, which unzip can break.
    await run("ditto", ["-x", "-k", zip, folder]);
    const app = (await readdir(folder)).find((name) => name.endsWith(".app"));
    if (app === undefined) throw new Error(`The download of ${release.version} holds no app.`);
    return join(folder, app);
  } catch (error) {
    await removeFolder(folder);
    throw error;
  }
};

/**
 * Swaps `bundle` for the `staged` app. The running process keeps the old one's files open, so it
 * carries on until it restarts; the old folder waits in the staging folder for `removeStaged`.
 */
export const install = async (staged: string, bundle: string) => {
  const previous = join(dirname(staged), `previous-${basename(bundle)}`);
  await rename(bundle, previous);
  try {
    await rename(staged, bundle);
  } catch (error) {
    await rename(previous, bundle);
    throw error;
  }
};

/** Deletes what earlier updates left next to `bundle`: downloads and the apps they replaced. */
export const removeStaged = async (bundle: string) => {
  const folder = dirname(bundle);
  const names = await readdir(folder).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(STAGING))
      .map((name) => removeFolder(join(folder, name))),
  );
};

/** The version in the `Info.plist` of the app at `bundle`. */
export const installedVersion = async (bundle: string) =>
  (
    await run("plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      join(bundle, "Contents/Info.plist"),
    ])
  ).stdout.trim();
