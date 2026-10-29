import { mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isInstalled, linkOcto } from "./octo-link.ts";

const scratch = () => {
  const home = mkdtempSync(join(tmpdir(), "octodo-link-"));
  const bundle = join(home, "Applications/octodo.app");
  mkdirSync(join(bundle, "Contents/Resources/bin"), { recursive: true });
  writeFileSync(join(bundle, "Contents/Resources/bin/octo"), "#!/bin/sh\n");
  return { home, bundle, link: join(home, ".local/bin/octo") };
};

const appOcto = (bundle: string) => join(bundle, "Contents/Resources/bin/octo");

it("links octo when there is none, making ~/.local/bin if needed", async () => {
  const { home, bundle, link } = scratch();
  await linkOcto(bundle, home);
  expect(readlinkSync(link)).toBe(appOcto(bundle));
});

it("replaces a link to an app that is gone", async () => {
  const { home, bundle, link } = scratch();
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  symlinkSync(join(home, "Downloads/octodo.app/Contents/Resources/bin/octo"), link);
  await linkOcto(bundle, home);
  expect(readlinkSync(link)).toBe(appOcto(bundle));
});

it("leaves an octo that works alone, such as a checkout's", async () => {
  const { home, bundle, link } = scratch();
  const checkout = join(home, "code/octodo/bin/octo");
  mkdirSync(join(home, "code/octodo/bin"), { recursive: true });
  writeFileSync(checkout, "#!/bin/sh\n");
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  symlinkSync(checkout, link);
  await linkOcto(bundle, home);
  expect(readlinkSync(link)).toBe(checkout);
});

it("counts only an app in an Applications folder as installed", () => {
  expect(isInstalled("/Applications/octodo.app", "/Users/me")).toBe(true);
  expect(isInstalled("/Users/me/Applications/octodo.app", "/Users/me")).toBe(true);
  expect(isInstalled("/Users/me/Downloads/octodo.app", "/Users/me")).toBe(false);
});
