import {
  channelOf,
  findUpdate,
  install,
  installedVersion,
  removeFolder,
  stage,
} from "@octodo/client/release";
import { InvalidRequest } from "@octodo/contract";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const APP_ID = "app.octodo.desktop";
const QUIT_TIMEOUT_MS = 15_000;

/** The pid of the octodo app while it is open, from Launch Services; quitting it needs no prompt. */
const openApp = async () => {
  const { stdout } = await run("lsappinfo", ["info", "-only", "pid", APP_ID]);
  const pid = /"pid"=(\d+)/.exec(stdout)?.[1];
  return pid === undefined ? undefined : Number(pid);
};

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Asks the app to quit (its main process quits on SIGTERM) and waits until it has. */
const quit = async (pid: number) => {
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (isRunning(pid)) {
    if (Date.now() > deadline) throw new Error("octodo did not quit; quit it and try again.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

const step = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({
    try: effect,
    catch: (error) => new InvalidRequest({ message: (error as Error).message }),
  });

export const upgradeCommand = Command.make(
  "upgrade",
  {
    channel: Flag.Literals("channel", ["stable", "nightly"]).pipe(
      Flag.withDescription("Channel to update from; defaults to the installed build's"),
      Flag.optional,
    ),
  },
  Effect.fn(function* ({ channel }) {
    // Set by the `octo` script inside the app, which knows the app it belongs to.
    const bundle = process.env["OCTODO_APP"];
    if (bundle === undefined)
      return yield* new InvalidRequest({
        message:
          "This octo runs from source: update it with git pull. octo upgrade updates the octodo app an installed octo comes with.",
      });
    const current = yield* step(() => installedVersion(bundle));
    const release = yield* step(() =>
      findUpdate(
        current,
        Option.getOrElse(channel, () => channelOf(current)),
      ),
    );
    if (release === null) return yield* Console.log(`octodo ${current} is up to date.`);
    yield* Console.log(`Downloading octodo ${release.version}...`);
    const staged = yield* step(() => stage(release, bundle));
    const pid = yield* step(openApp);
    if (pid !== undefined) {
      yield* Console.log("Quitting octodo...");
      yield* step(() => quit(pid));
    }
    yield* step(() => install(staged, bundle));
    yield* step(() => removeFolder(dirname(staged)));
    if (pid !== undefined) yield* step(() => run("open", [bundle]));
    yield* Console.log(`Updated octodo ${current} to ${release.version}.`);
  }),
).pipe(
  Command.withDescription("Update the octodo app this octo comes with, and this octo with it"),
);
