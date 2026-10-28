import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// OCTODO_API_PORT points the dev proxy at a server on another port, e.g. a second instance.
const api = `http://127.0.0.1:${process.env["OCTODO_API_PORT"] ?? "4520"}`;

const proxy: ProxyOptions = {
  target: api,
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
