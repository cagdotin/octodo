/**
 * Keeps the desktop app connected to one octodo server (decision 0021): the one `server.json`
 * names when it answers as this version does, or a child this app spawns and restarts.
 */
import { NodeServices } from "@effect/platform-node";
import { findServer } from "@octodo/client";
import { readServerInfo } from "@octodo/engine";
import { Effect, Option } from "effect";
import { spawn, type ChildProcess } from "node:child_process";

/** What the server child tells its parent over IPC, once. */
export type ChildMessage =
  | { readonly listening: string }
  | { readonly failed: string; readonly message: string };

/** Why there is no server to use, worded for the person. */
export interface Problem {
  readonly title: string;
  readonly detail: string;
}

/** The server the app talks to: one it found running, or its own child. */
type Server =
  | { readonly kind: "attached"; readonly url: string; readonly pid: number }
  | { readonly kind: "child"; readonly url: string; readonly child: ChildProcess };

/** A child that never got to listen; `inUse` when its port was taken. */
class SpawnFailed extends Error {
  readonly inUse: boolean;
  constructor(message: string, inUse: boolean) {
    super(message);
    this.inUse = inUse;
  }
}

export interface BackendOptions {
  readonly home: string;
  /** The port a new child listens on first; it keeps the port of the one before it. */
  readonly port: number;
  readonly webDir: string;
  /** The bundled `server.mjs` the child runs. */
  readonly script: string;
  /** Called with the server's url each time the app (re)connects to a server. */
  readonly onServer: (url: string) => void;
  /** Shows a problem to the person; resolves true to try again, false to quit. */
  readonly onProblem: (problem: Problem) => Promise<boolean>;
}

const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5000;
const ATTACHED_POLL_MS = 1000;
/** A child that ran this long before it stopped counts as healthy: the next restart is quick. */
const HEALTHY_MS = 30_000;
/** Restarts in a row before the person is asked; each waits twice as long as the one before. */
const RESTARTS = 5;
const FIRST_DELAY_MS = 500;
const LOG_LINES = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The server `server.json` names when it can be used, null when none runs, or why not. */
const locate = (home: string): Promise<{ url: string; pid: number } | null | Problem> =>
  Effect.runPromise(
    findServer(home).pipe(
      Effect.map(Option.getOrNull),
      Effect.catchTags({
        ServerMismatch: (error) =>
          Effect.succeed<Problem>({
            title: "Another version of octodo is running",
            detail: `The octodo server at ${error.url} is version ${error.version}, and this app is ${error.expected}. Stop that server, or start it again from this version, then try again.`,
          }),
        ServerUnavailable: (error) =>
          Effect.succeed<Problem>({
            title: "The octodo server does not respond",
            detail: error.message,
          }),
        StorageError: (error) =>
          Effect.succeed<Problem>({
            title: "octodo cannot read server.json",
            detail: `${error.message}: ${String(error.cause)}`,
          }),
      }),
      Effect.provide(NodeServices.layer),
    ),
  );

/** Whether `server.json` still names this server; a file that does not read counts as yes. */
const names = (home: string, server: { readonly url: string; readonly pid: number }) =>
  Effect.runPromise(
    readServerInfo(home).pipe(
      Effect.map(
        Option.match({
          onNone: () => false,
          onSome: (info) => info.url === server.url && info.pid === server.pid,
        }),
      ),
      Effect.orElseSucceed(() => true),
      Effect.provide(NodeServices.layer),
    ),
  );

const isProblem = (value: unknown): value is Problem =>
  typeof value === "object" && value !== null && "title" in value;

export const startBackend = (options: BackendOptions) => {
  let stopping = false;
  /** The child this app spawned and that has not exited, listening or not yet. */
  let owned: ChildProcess | undefined;
  let port = options.port;
  const log: Array<string> = [];

  const remember = (chunk: Buffer) => {
    log.push(...chunk.toString().trimEnd().split("\n"));
    log.splice(0, Math.max(0, log.length - LOG_LINES));
  };

  const spawnChild = (listenOn: number): Promise<Server> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [options.script], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          OCTODO_HOME: options.home,
          OCTODO_PORT: String(listenOn),
          OCTODO_WEB_DIR: options.webDir,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      owned = child;
      child.once("exit", () => {
        if (owned === child) owned = undefined;
      });
      child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
      child.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
        remember(chunk);
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new SpawnFailed(`did not listen within ${READY_TIMEOUT_MS / 1000} s`, false));
      }, READY_TIMEOUT_MS);
      const exited = (code: number | null, signal: string | null) => {
        clearTimeout(timeout);
        reject(new SpawnFailed(`stopped before it listened (${signal ?? `exit ${code}`})`, false));
      };
      child.once("exit", exited);
      child.once("message", (message: ChildMessage) => {
        clearTimeout(timeout);
        child.off("exit", exited);
        if ("listening" in message) {
          port = Number(new URL(message.listening).port);
          resolve({ kind: "child", url: message.listening, child });
        } else {
          child.kill("SIGKILL");
          reject(new SpawnFailed(message.message, message.failed === "EADDRINUSE"));
        }
      });
    });

  /** Attaches to the server `server.json` names, or spawns one; never runs two. */
  const connect = async (): Promise<Server | Problem> => {
    const found = await locate(options.home);
    if (isProblem(found)) return found;
    if (found !== null) return { kind: "attached", ...found };
    try {
      return await spawnChild(port);
    } catch (error) {
      if (!(error instanceof SpawnFailed && error.inUse)) throw error;
      // Another octodo may have taken the port since; use it, or any free port if it is not one.
      const again = await locate(options.home);
      if (isProblem(again)) return again;
      if (again !== null) return { kind: "attached", ...again };
      return await spawnChild(0);
    }
  };

  /**
   * Resolves once the server is gone: the child exits, or the attached server's process ends or
   * `server.json` stops naming it (a server removes its entry when it closes).
   */
  const lost = async (server: Server) => {
    if (server.kind === "child") {
      const { child } = server;
      if (child.exitCode === null && child.signalCode === null)
        await new Promise((resolve) => child.once("exit", resolve));
      return;
    }
    while (!stopping && isRunning(server.pid) && (await names(options.home, server))) {
      await sleep(ATTACHED_POLL_MS);
    }
  };

  const keepsStopping = (reason: string): Problem => ({
    title: "The octodo server keeps stopping",
    detail: [`It ${reason}.`, ...log.slice(-8)].join("\n"),
  });

  const run = async (): Promise<boolean> => {
    let failures = 0;
    while (!stopping) {
      let found: Server | Problem;
      const started = Date.now();
      try {
        found = await connect();
      } catch (error) {
        found = keepsStopping(error instanceof SpawnFailed ? error.message : String(error));
        failures++;
        if (failures < RESTARTS && !stopping) {
          await sleep(FIRST_DELAY_MS * 2 ** (failures - 1));
          continue;
        }
      }
      if (stopping) break;
      if (isProblem(found)) {
        failures = 0;
        if (!(await options.onProblem(found))) return false;
        continue;
      }
      options.onServer(found.url);
      await lost(found);
      if (stopping) break;
      if (found.kind === "attached") continue;
      failures = Date.now() - started >= HEALTHY_MS ? 1 : failures + 1;
      if (failures >= RESTARTS) {
        failures = 0;
        if (!(await options.onProblem(keepsStopping("stopped " + RESTARTS + " times in a row"))))
          return false;
        continue;
      }
      await sleep(FIRST_DELAY_MS * 2 ** (failures - 1));
    }
    return true;
  };

  return {
    /** Runs until `stop()`; false when the person chose to quit over a problem. */
    running: run(),
    /** Stops the child this app spawned, so its `server.json` goes; an attached server keeps running. */
    stop: async () => {
      stopping = true;
      const child = owned;
      if (child === undefined) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
      await exited;
      clearTimeout(timeout);
    },
  };
};
