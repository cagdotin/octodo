import { defineConfig } from "tsdown";

// Electron ships its own Node (24), which cannot run the workspace's TypeScript sources directly,
// so the main process and everything it imports are bundled into one file. The preload runs in a
// sandboxed renderer, which needs a single CommonJS file.
export default defineConfig([
  {
    entry: ["src/main.ts"],
    format: "esm",
    platform: "node",
    target: "node24",
    outDir: "dist",
    dts: false,
    clean: true,
    deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$)/], onlyBundle: false },
  },
  {
    entry: ["src/preload.ts"],
    format: "cjs",
    platform: "node",
    target: "node24",
    outDir: "dist",
    dts: false,
    clean: false,
    deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$)/], onlyBundle: false },
  },
]);
