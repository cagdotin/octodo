import type { Plugin } from "@octodo/engine";

/**
 * Every plugin octodo has, by its `engine` half. Each lives in its own folder with a `shared.ts`
 * (`PluginShared`: anything any client may import), an `engine.ts` (`definePlugin`) and a
 * `web.tsx`; a workspace's config.json picks which of them apply there (decision 0014).
 */
export const plugins: ReadonlyArray<Plugin> = [];
