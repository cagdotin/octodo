import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UpdateWorkspaceInput } from "@octodo/contract";
import { initWorkspace, makeWorkspace } from "../src/workspace.ts";

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, ".octodo/config.json"), "utf8"));

/** HM-1 with subtask HM-3, blocked by HM-2 and mentioning it in prose and in code. */
const houseMove = async () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root, { name: "House move", key: "HM" }));
  await run(
    Effect.gen(function* () {
      const ws = yield* makeWorkspace("test", root);
      yield* ws.createTask({ title: "Paint fence" });
      yield* ws.createTask({ title: "Buy paint" });
      yield* ws.createTask({ title: "Sand", parent: "HM-1" });
      yield* ws.updateTask("HM-1", {
        blocked_by: ["HM-2"],
        body: "After [[HM-2]], not `[[HM-2]]` or HM-2a.",
      });
    }),
  );
  return root;
};

const changeKey = (root: string, key: string) =>
  run(
    Effect.gen(function* () {
      const ws = yield* makeWorkspace("test", root);
      const info = yield* ws.update({ key });
      return { info, snapshot: yield* ws.snapshot };
    }),
  );

const update = (root: string, input: UpdateWorkspaceInput) =>
  run(Effect.flatMap(makeWorkspace("test", root), (ws) => ws.update(input)));

describe("updateWorkspace", () => {
  it("sets the trimmed name and description in config.json and keeps its other keys", async () => {
    const root = await houseMove();
    const info = await update(root, { name: " Wald ", description: " Weekend jobs " });
    expect(info).toMatchObject({ name: "Wald", key: "HM", description: "Weekend jobs" });
    expect(config(root)).toMatchObject({ name: "Wald", key: "HM", description: "Weekend jobs" });
    expect(config(root).statuses, "the statuses stay").toHaveLength(6);
  });

  it("removes the description when it is null or blank, and leaves left-out fields alone", async () => {
    const root = await houseMove();
    await update(root, { description: "Weekend jobs" });
    const info = await update(root, { description: "  " });
    expect(info.description).toBeUndefined();
    expect(config(root)).not.toHaveProperty("description");
    expect(config(root).name).toBe("House move");
  });

  it("moves ids only when the key changes", async () => {
    const root = await houseMove();
    const info = await update(root, { name: "Wald", key: "HM" });
    expect(info).toMatchObject({ name: "Wald", key: "HM" });
    expect(existsSync(join(root, ".octodo/tasks/HM-1-paint-fence"))).toBe(true);
  });

  it("refuses a blank name", async () => {
    const root = await houseMove();
    await expect(update(root, { name: "  ", key: "OCT" })).rejects.toThrow(
      "A workspace needs a name",
    );
    expect(config(root).key, "a refused update changes nothing").toBe("HM");
  });
});

describe("updateWorkspace with a new key", () => {
  it("moves every id, link, mention and folder name to the new key", async () => {
    const root = await houseMove();
    const { info, snapshot } = await changeKey(root, "OCT");
    expect(info.key).toBe("OCT");
    expect(config(root).key).toBe("OCT");
    expect(snapshot.tasks.map((task) => task.id).toSorted()).toEqual(["OCT-1", "OCT-2", "OCT-3"]);
    const fence = snapshot.tasks.find((task) => task.id === "OCT-1")!;
    expect(fence.blockedBy).toEqual(["OCT-2"]);
    expect(fence.body, "a mention in code and a lookalike stay as written").toBe(
      "After [[OCT-2]], not `[[HM-2]]` or HM-2a.\n",
    );
    expect(snapshot.tasks.find((task) => task.id === "OCT-3")!.parent).toBe("OCT-1");
    expect(existsSync(join(root, ".octodo/tasks/OCT-1-paint-fence/OCT-3-sand/task.md"))).toBe(true);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("numbers new tasks after the moved ids", async () => {
    const root = await houseMove();
    await changeKey(root, "OCT");
    const created = await run(
      Effect.flatMap(makeWorkspace("test", root), (ws) => ws.createTask({ title: "Next" })),
    );
    expect(created.id).toBe("OCT-4");
  });

  it("finishes a run that stopped before config.json took the key", async () => {
    const root = await houseMove();
    const file = join(root, ".octodo/tasks/HM-2-buy-paint/task.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("id: HM-2", "id: OCT-2"));
    renameSync(
      join(root, ".octodo/tasks/HM-2-buy-paint"),
      join(root, ".octodo/tasks/OCT-2-buy-paint"),
    );
    const { snapshot } = await changeKey(root, "OCT");
    expect(snapshot.tasks.map((task) => task.id).toSorted()).toEqual(["OCT-1", "OCT-2", "OCT-3"]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("refuses a key whose ids are already on disk with the same numbers", async () => {
    const root = await houseMove();
    mkdirSync(join(root, ".octodo/tasks/copied"));
    writeFileSync(
      join(root, ".octodo/tasks/copied/task.md"),
      "---\nid: OCT-2\ntitle: Copied\nstatus: todo\n---\n",
    );
    await expect(changeKey(root, "OCT")).rejects.toThrow("OCT-2 already exists next to HM-2");
    expect(config(root).key, "nothing changes").toBe("HM");
    expect(existsSync(join(root, ".octodo/tasks/HM-1-paint-fence"))).toBe(true);
  });

  it("refuses while a task's frontmatter does not read", async () => {
    const root = await houseMove();
    writeFileSync(join(root, ".octodo/tasks/HM-2-buy-paint/task.md"), "---\nid: [HM-2\n---\n");
    await expect(changeKey(root, "OCT")).rejects.toThrow("HM-2-buy-paint/task.md");
    expect(config(root).key).toBe("HM");
  });
});
