import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace, makeWorkspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

/** A workspace with the default statuses and a task whose status `in-review` is not one of them. */
const withUnknownStatus = async () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root, { key: "HM" }));
  mkdirSync(join(root, ".octodo/HM-1-review"));
  writeFileSync(
    join(root, ".octodo/HM-1-review/task.md"),
    "---\nid: HM-1\ntitle: Review\nstatus: in-review\n---\n",
  );
  return root;
};

const configuredIds = (root: string): Array<string> =>
  JSON.parse(readFileSync(join(root, ".octodo/config.json"), "utf8")).statuses.map(
    (status: { id: string }) => status.id,
  );

describe("reorderStatuses", () => {
  it("takes the order of every status shown and writes only the ones config.json has", async () => {
    const root = await withUnknownStatus();
    const result = await run(
      Effect.gen(function* () {
        const ws = yield* makeWorkspace("test", root);
        const shown = (yield* ws.snapshot).statuses.map((status) => status.id);
        const statuses = yield* ws.reorderStatuses({
          order: ["done", "in-progress", "in-review", "todo", "backlog", "canceled", "archived"],
        });
        return { shown, statuses, diagnostics: (yield* ws.snapshot).diagnostics };
      }),
    );
    expect(result.shown, "the snapshot shows the unknown status").toContain("in-review");
    expect(configuredIds(root), "reordering does not add the unknown status").toEqual([
      "backlog",
      "todo",
      "in-progress",
      "done",
      "canceled",
      "archived",
    ]);
    expect(result.statuses.map((status) => status.id)).toEqual([
      "backlog",
      "todo",
      "in-review",
      "in-progress",
      "done",
      "canceled",
      "archived",
    ]);
    expect(
      result.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.fix?.action]),
      "the status stays a diagnostic, added only when asked",
    ).toEqual([["unknown-status", "add-status"]]);
  });

  it("reorders the configured statuses within their category", async () => {
    const root = await withUnknownStatus();
    const config = JSON.parse(readFileSync(join(root, ".octodo/config.json"), "utf8"));
    config.statuses.splice(2, 0, { id: "waiting", name: "Waiting", category: "unstarted" });
    writeFileSync(join(root, ".octodo/config.json"), JSON.stringify(config));
    await run(
      Effect.flatMap(makeWorkspace("test", root), (ws) =>
        ws.reorderStatuses({
          order: [
            "archived",
            "canceled",
            "done",
            "in-progress",
            "in-review",
            "waiting",
            "todo",
            "backlog",
          ],
        }),
      ),
    );
    expect(configuredIds(root)).toEqual([
      "backlog",
      "waiting",
      "todo",
      "in-progress",
      "done",
      "canceled",
      "archived",
    ]);
  });

  it("refuses an order that leaves out a status shown", async () => {
    const root = await withUnknownStatus();
    const before = readFileSync(join(root, ".octodo/config.json"), "utf8");
    const error = await run(
      Effect.flatMap(makeWorkspace("test", root), (ws) =>
        Effect.flip(
          ws.reorderStatuses({ order: ["backlog", "todo", "in-progress", "done", "archived"] }),
        ),
      ),
    );
    expect(error._tag).toBe("InvalidRequest");
    expect(readFileSync(join(root, ".octodo/config.json"), "utf8")).toBe(before);
  });
});
