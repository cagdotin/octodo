import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace } from "../src/workspace.ts";
import { Workspaces } from "../src/workspaces.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>, home: string) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Workspaces.layer({ home, watch: false }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
      Effect.scoped,
    ) as Effect.Effect<A, E>,
  );

describe("workspaces", () => {
  it("browses folders, marking the ones that are workspaces and skipping hidden ones", async () => {
    const base = mkdtempSync(join(tmpdir(), "octodo-browse-"));
    for (const dir of ["beta", "alpha", ".hidden"]) mkdirSync(join(base, dir));
    writeFileSync(join(base, "notes.txt"), "not a folder");
    await run(initWorkspace(join(base, "beta")), base);
    const listing = await run(
      Workspaces.use((w) => w.browse(base)),
      join(base, ".home"),
    );
    expect(listing).toEqual({
      path: base,
      parent: join(base, ".."),
      workspace: false,
      folders: [
        { name: "alpha", path: join(base, "alpha"), workspace: false },
        { name: "beta", path: join(base, "beta"), workspace: true },
      ],
    });
  });

  it("refuses relative and missing paths", async () => {
    const home = mkdtempSync(join(tmpdir(), "octodo-browse-"));
    const errors = await run(
      Effect.all([
        Effect.flip(Workspaces.use((w) => w.browse("relative/path"))),
        Effect.flip(Workspaces.use((w) => w.browse(join(home, "missing")))),
      ]),
      home,
    );
    expect(errors.map((error) => error.message)).toEqual([
      "Use an absolute folder path",
      `No folder at ${join(home, "missing")}`,
    ]);
  });
});
