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

  it("opens a folder path, a relative path or a registered id, and names what it could not find", async () => {
    const base = mkdtempSync(join(tmpdir(), "octodo-open-"));
    const home = join(base, ".home");
    const garden = join(base, "garden");
    mkdirSync(join(garden, "seeds"), { recursive: true });
    const cwd = process.cwd();
    process.chdir(join(garden, "seeds"));
    try {
      const opened = await run(
        Workspaces.use((w) =>
          Effect.gen(function* () {
            yield* w.add(garden);
            const targets = [join(garden, "seeds"), ".", "../seeds", "garden"];
            const found = yield* Effect.forEach(targets, (target) => w.open(target));
            const missing = yield* Effect.forEach(["nosuch", base], (target) =>
              Effect.flip(w.open(target)),
            );
            return { found, missing };
          }),
        ),
        home,
      );
      expect(opened.found.map(({ id, root }) => ({ id, root }))).toEqual(
        Array(4).fill({ id: "garden", root: garden }),
      );
      expect(opened.missing.map((error) => error.message)).toEqual([
        "No workspace found for nosuch",
        `No workspace found for ${base}`,
      ]);
    } finally {
      process.chdir(cwd);
    }
  });
});
