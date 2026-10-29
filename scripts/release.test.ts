import { describe, expect, it } from "vitest";
import { channelOf, compareVersions } from "../packages/client/src/release.ts";
import { nightlyVersion, prunable, stableVersionOf } from "./release.ts";

describe("versions", () => {
  it("orders releases as semantic versioning does", () => {
    const sorted = [
      "0.4.0",
      "0.4.0-nightly.20261030.43",
      "0.3.0",
      "0.4.0-nightly.20261029.42",
      "0.4.0-nightly.20261029.9",
      "0.10.0",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "0.3.0",
      "0.4.0-nightly.20261029.9",
      "0.4.0-nightly.20261029.42",
      "0.4.0-nightly.20261030.43",
      "0.4.0",
      "0.10.0",
    ]);
  });

  it("numbers a nightly after the newest stable tag, ignoring other nightlies", () => {
    const tags = ["v0.2.0", "v0.3.0", "v0.4.0-nightly.20261028.40", "nightly", ""];
    expect(nightlyVersion(tags, "20261029", 41)).toBe("0.4.0-nightly.20261029.41");
    expect(nightlyVersion([], "20261029", 1)).toBe("0.1.0-nightly.20261029.1");
  });

  it("promotes a nightly to the stable version it previews, on the stable channel", () => {
    expect(stableVersionOf("0.4.0-nightly.20261029.41")).toBe("0.4.0");
    expect(channelOf("0.4.0-nightly.20261029.41")).toBe("nightly");
    expect(channelOf("0.4.0")).toBe("stable");
  });
});

describe("pruning nightlies", () => {
  it("deletes drafts and keeps the newest ten published nightlies", () => {
    const published = Array.from({ length: 12 }, (_, i) => ({
      tagName: `v0.4.0-nightly.20261029.${i + 1}`,
      isDraft: false,
    }));
    const releases = [
      ...published,
      { tagName: "v0.4.0-nightly.20261029.13", isDraft: true },
      { tagName: "v0.3.0", isDraft: false },
      { tagName: "v0.4.0", isDraft: true },
      { tagName: "nightly", isDraft: false },
    ];
    expect(prunable(releases)).toEqual([
      "v0.4.0-nightly.20261029.13",
      "v0.4.0-nightly.20261029.1",
      "v0.4.0-nightly.20261029.2",
    ]);
  });
});
