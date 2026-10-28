/**
 * The server child the desktop app spawns (`ELECTRON_RUN_AS_NODE=1`). It tells its parent over IPC
 * that it listens, or why it could not, and closes cleanly (removing `server.json`) when the parent
 * asks it to stop or goes away, even while it is still starting.
 */
import { startServer } from "@octodo/server";
import type { ChildMessage } from "./backend.ts";

const env = (name: string) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const send = (message: ChildMessage) =>
  new Promise<void>((resolve) => {
    if (process.send === undefined) resolve();
    else process.send(message, () => resolve());
  });

const stopAsked = new Promise<void>((resolve) => {
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
  process.once("disconnect", resolve);
  if (process.send !== undefined && !process.connected) resolve();
});

const server = await startServer({
  home: env("OCTODO_HOME"),
  port: Number(env("OCTODO_PORT")),
  webDir: process.env["OCTODO_WEB_DIR"],
}).catch(async (error: NodeJS.ErrnoException) => {
  await send({ failed: error.code ?? "", message: error.message });
  process.exit(1);
});

await send({ listening: server.url });
await stopAsked;
await server.close().finally(() => process.exit(0));
