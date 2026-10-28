import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The code the web app bundles: its own, the UI kit and the plugins' web halves. */
const ROOT = join(import.meta.dirname, "../../..");
const SOURCES = ["apps/web/src", "packages/ui/src", "packages/plugins/src"];

/** Ways to get a scrollbar that differs from ScrollArea's, and the files allowed each one. */
const RULES = [
  {
    name: "native scrolling",
    pattern:
      /\boverflow-(?:[xy]-)?(?:auto|scroll)\b|\boverflow(?:X|Y|-x|-y)?\s*:\s*["']?(?:auto|scroll)\b/g,
    allowed: [],
  },
  {
    name: "a hidden scrollbar",
    pattern: /\bno-scrollbar\b|\bscrollbar-?[wW]idth\b|::-webkit-scrollbar/g,
    allowed: ["apps/web/src/components/quick-add/editor.ts"],
  },
] as const;

const sources = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });

const violations = (file: string) => {
  const path = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  return RULES.flatMap((rule) =>
    (rule.allowed as ReadonlyArray<string>).includes(path)
      ? []
      : lines.flatMap((line, index) =>
          [...line.matchAll(rule.pattern)].map(
            ([match]) =>
              `${path}:${index + 1} uses ${rule.name} (${match}). Put the scrolling content in ` +
              `<ScrollArea> from @octodo/ui/components/scroll-area, so every scrollbar looks and behaves ` +
              `like the task list's.`,
          ),
        ),
  );
};

describe("scrolling", () => {
  it("goes through ScrollArea everywhere", () => {
    expect(SOURCES.flatMap((dir) => sources(join(ROOT, dir))).flatMap(violations)).toEqual([]);
  });
});
