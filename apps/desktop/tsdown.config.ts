import { defineConfig, type UserConfig } from "tsdown";

// Electron ships its own Node (24), which cannot run the workspace's TypeScript sources directly,
// so the main process, the server child it spawns, the `octo` CLI it ships and everything they
// import are bundled into one file each. The preload runs in a sandboxed renderer, which needs a
// single CommonJS file.
const bundle = (entry: string | Record<string, string>, format: "esm" | "cjs"): UserConfig => ({
  entry: typeof entry === "string" ? [entry] : entry,
  format,
  platform: "node",
  target: "node24",
  outDir: "dist",
  dts: false,
  clean: false,
  deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$)/], onlyBundle: false },
});

export default defineConfig([
  { ...bundle("src/main.ts", "esm"), clean: true },
  bundle("src/server.ts", "esm"),
  bundle({ cli: "../../packages/cli/src/main.ts" }, "esm"),
  bundle("src/preload.ts", "cjs"),
]);
