// Development entry point: `pnpm dev` runs this next to the Vite dev server, which proxies /api.
import { defaultHome } from "@octodo/core";
import { homedir } from "node:os";
import { startServer } from "./index.ts";

const server = await startServer({
  home: defaultHome(process.env, homedir()),
  port: Number(process.env["OCTODO_PORT"] ?? 4520),
});

const devUrl = process.env["OCTODO_WEB_URL"] ?? "http://localhost:5520";
console.log(`octodo API on ${server.url}`);
console.log(`Open ${devUrl}`);

const shutdown = () => void server.close().then(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
