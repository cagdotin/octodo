import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const DECISIONS = join(ROOT, "docs/decisions");

const markdownUnder = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownUnder(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });

const DOCS = [
  join(ROOT, "AGENTS.md"),
  join(ROOT, "README.md"),
  ...markdownUnder(join(ROOT, "docs")),
];

const withoutCode = (markdown: string) =>
  markdown.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");

const githubSlug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const anchorsOf = (file: string) => {
  const seen = new Map<string, number>();
  return new Set(
    [...withoutCode(readFileSync(file, "utf8")).matchAll(/^#{1,6}\s+(.+)$/gm)].map(
      ([, heading]) => {
        const slug = githubSlug(heading ?? "");
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        return count === 0 ? slug : `${slug}-${count}`;
      },
    ),
  );
};

const relativeLinks = (file: string) =>
  [...withoutCode(readFileSync(file, "utf8")).matchAll(/\]\(([^)\s]+)\)|\bsrc(?:set)?="([^"]+)"/g)]
    .map(([, link, source]) => link ?? source ?? "")
    .filter((link) => !/^[a-z]+:/i.test(link));

const brokenLink = (file: string, link: string) => {
  const [path = "", anchor] = link.split("#");
  const target = path === "" ? file : resolve(dirname(file), decodeURI(path));
  if (!existsSync(target)) return "no such file";
  if (anchor === undefined) return undefined;
  if (statSync(target).isDirectory() || !target.endsWith(".md"))
    return "anchor on a non-markdown target";
  return anchorsOf(target).has(anchor) ? undefined : `no heading #${anchor}`;
};

const recordHeader = (file: string) => {
  const text = readFileSync(join(DECISIONS, file), "utf8");
  return {
    title: /^# \d{4}\. (.+)$/m.exec(text)?.[1],
    status: /^- Status: (.+)$/m.exec(text)?.[1],
  };
};

const indexRows = () =>
  new Map(
    [
      ...readFileSync(join(DECISIONS, "README.md"), "utf8").matchAll(
        /^\| \[\d{4}\]\((\d{4}-[^)]+\.md)\) +\| (.+?) +\| (.+?) +\|$/gm,
      ),
    ].map(([, file, title, status]) => [file ?? "", { title, status }]),
  );

describe("docs", () => {
  it("has relative links that resolve", () => {
    const broken = DOCS.flatMap((file) =>
      relativeLinks(file).flatMap((link) => {
        const problem = brokenLink(file, link);
        return problem === undefined ? [] : [`${relative(ROOT, file)}: ${link} (${problem})`];
      }),
    );
    expect(broken, "Fix the link or the file it points at.").toEqual([]);
  });

  it("indexes every decision record with its title and status", () => {
    const records = readdirSync(DECISIONS).filter((file) => /^\d{4}-.+\.md$/.test(file));
    const rows = indexRows();
    expect(
      Object.fromEntries(records.map((file) => [file, rows.get(file)])),
      "Each docs/decisions/NNNN-*.md needs a row in docs/decisions/README.md whose title and status match the record's heading and Status line.",
    ).toEqual(Object.fromEntries(records.map((file) => [file, recordHeader(file)])));
    expect([...rows.keys()].toSorted(), "The index lists only records that exist.").toEqual(
      records.toSorted(),
    );
  });
});
