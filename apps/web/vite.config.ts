import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// The engine's defaultHome, which this config cannot import.
const home =
  process.env["OCTODO_HOME"] ??
  join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "octodo");

/**
 * The server to proxy to: the one on OCTODO_API_PORT when it is set, otherwise the one
 * `server.json` names at each request, as every octodo client finds it (decision 0018). The desktop
 * app's server can be one it attached to or a child on another port.
 */
const target = () => {
  const port = process.env["OCTODO_API_PORT"];
  if (port !== undefined) return `http://127.0.0.1:${port}`;
  try {
    return (JSON.parse(readFileSync(join(home, "server.json"), "utf8")) as { url: string }).url;
  } catch {
    return "http://127.0.0.1:4520";
  }
};

const proxy: ProxyOptions = {
  // The proxy copies its options at each request, so a getter gives each one the current server.
  get target() {
    return target();
  },
  configure: (server) => {
    server.on("proxyRes", (res, _req, out) => {
      if (!String(res.headers["content-type"]).startsWith("text/event-stream")) return;
      // If the API goes away, drop the browser's stream too so EventSource notices and the sync
      // machine can reconnect; otherwise the proxy keeps it open forever.
      res.once("close", () => {
        if (!out.writableEnded) out.destroy();
      });
    });
  },
};

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5520,
    strictPort: true,
    proxy: {
      "/api": proxy,
      "/mcp": proxy,
    },
  },
});
