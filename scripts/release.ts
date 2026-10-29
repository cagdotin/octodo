/**
 * The steps of the release workflows that are more than a `gh` call (decision 0029): the version a
 * build gets, the feed file installed apps read, and pruning old nightlies.
 *
 *   node scripts/release.ts nightly-version         the next nightly's version, from the git tags
 *   node scripts/release.ts latest-nightly          the newest nightly's tag
 *   node scripts/release.ts feed <zip> <version> <url>   the feed JSON naming that zip
 *   node scripts/release.ts prune                   deletes nightlies past the newest few, and drafts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compareVersions } from "../packages/client/src/release.ts";

const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;
const NIGHTLY_TAG = /^v(\d+\.\d+\.\d+-nightly\.\d+\.\d+)$/;
const NIGHTLIES_KEPT = 10;

/** The newest version among the tags `pattern` matches. */
export const newest = (tags: ReadonlyArray<string>, pattern: RegExp) =>
  tags
    .flatMap((tag) => pattern.exec(tag)?.[1] ?? [])
    .sort(compareVersions)
    .at(-1);

/** A nightly previews the release after the newest stable one: after 0.3.0, 0.4.0-nightly.<day>.<run>. */
export const nightlyVersion = (tags: ReadonlyArray<string>, day: string, run: number) => {
  const [major = 0, minor = 0] = (newest(tags, STABLE_TAG) ?? "0.0.0").split(".").map(Number);
  return `${major}.${minor + 1}.0-nightly.${day}.${run}`;
};

/** The stable version a nightly previews. */
export const stableVersionOf = (nightly: string) => nightly.split("-")[0]!;

/** The nightly releases to delete: drafts a cancelled build left, and all but the newest few. */
export const prunable = (
  releases: ReadonlyArray<{ readonly tagName: string; readonly isDraft: boolean }>,
) => {
  const nightlies = releases.filter((release) => NIGHTLY_TAG.test(release.tagName));
  const published = nightlies
    .filter((release) => !release.isDraft)
    .map((release) => release.tagName)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));
  return [
    ...nightlies.filter((release) => release.isDraft).map((release) => release.tagName),
    ...published.slice(0, Math.max(0, published.length - NIGHTLIES_KEPT)),
  ];
};

const tags = () => execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n");

const commands: Record<string, (args: ReadonlyArray<string>) => string> = {
  "nightly-version": () => {
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return nightlyVersion(tags(), day, Number(process.env["GITHUB_RUN_NUMBER"] ?? 0));
  },
  "latest-nightly": () => {
    const version = newest(tags(), NIGHTLY_TAG);
    if (version === undefined) throw new Error("No nightly has been published yet.");
    return `v${version}`;
  },
  "stable-version": ([nightly = ""]) => stableVersionOf(nightly.replace(/^v/, "")),
  feed: ([zip = "", version = "", url = ""]) => {
    const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
    return JSON.stringify({ version, url, sha256 }, null, 2);
  },
  prune: () => {
    const releases = JSON.parse(
      execFileSync("gh", ["release", "list", "--limit", "200", "--json", "tagName,isDraft"], {
        encoding: "utf8",
      }),
    );
    const doomed = prunable(releases);
    for (const tag of doomed)
      execFileSync("gh", ["release", "delete", tag, "--yes", "--cleanup-tag"], {
        stdio: "inherit",
      });
    return `Deleted ${doomed.length} nightly releases.`;
  },
};

if (import.meta.main) {
  const [name = "", ...args] = process.argv.slice(2);
  const command = commands[name];
  if (command === undefined) {
    console.error(`Unknown command "${name}"; see the top of scripts/release.ts.`);
    process.exit(1);
  }
  console.log(command(args));
}
