import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace, makeWorkspace, type Workspace } from "../src/workspace.ts";

/** Each call is its own runtime, as another process would be: nothing is shared but the files. */
const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

const CRASH = join(import.meta.dirname, "crash.ts");

/** Another octodo process running `operation` on the workspace; see `crash.ts`. */
const octodo = (root: string, operation: string, atPublish: "go" | "pause" | "kill" = "go") => {
  const child = spawn(process.execPath, [CRASH, root, operation, atPublish]);
  let out = "";
  let err = "";
  child.stdout.on("data", (data) => (out += String(data)));
  child.stderr.on("data", (data) => (err += String(data)));
  const exited = new Promise<{ ids: Array<string>; signal: string | null; stderr: string }>(
    (resolve) =>
      child.once("exit", (_code, signal) =>
        resolve({ ids: out.match(/[A-Z]+-\d+/g) ?? [], signal, stderr: err }),
      ),
  );
  const paused = new Promise<void>((resolve) =>
    child.stdout.on("data", () => out.includes("paused") && resolve()),
  );
  let running = true;
  void exited.then(() => (running = false));
  return {
    exited,
    paused,
    running: () => running,
    resume: () => child.stdin.write("go\n"),
  };
};

/** Runs `operation` in another process that dies with SIGKILL as it publishes its first write. */
const crash = (root: string, operation: "create" | "read") => {
  const child = spawnSync(process.execPath, [CRASH, root, operation, "kill"]);
  expect({ signal: child.signal, stderr: String(child.stderr) }).toMatchObject({
    signal: "SIGKILL",
  });
};

/** Hidden entries under `.octodo/` other than its `.gitignore` and the owner lock. */
const leftovers = (root: string) =>
  readdirSync(join(root, ".octodo"), { recursive: true, encoding: "utf8" }).filter(
    (entry) =>
      entry !== ".gitignore" &&
      entry !== ".owner-lock" &&
      entry.split("/").some((part) => part.startsWith(".")),
  );

const fresh = async () => {
  const root = join(mkdtempSync(join(tmpdir(), "octodo-")), "house-move");
  mkdirSync(root);
  await run(initWorkspace(root));
  return root;
};

const write = (root: string, file: string, content: string) => {
  mkdirSync(dirname(join(root, ".octodo", file)), { recursive: true });
  writeFileSync(join(root, ".octodo", file), content);
};

const read = (root: string, file: string) => readFileSync(join(root, ".octodo", file), "utf8");

/** A workspace that stays open across calls, as the app keeps one with its cache. */
const openApp = async (root: string) => {
  let workspace!: Workspace;
  let close!: () => void;
  const closed = new Promise<void>((resolve) => (close = resolve));
  const opened = new Promise<void>((resolve) => {
    void run(
      Effect.gen(function* () {
        workspace = yield* makeWorkspace("app", root);
        resolve();
        yield* Effect.promise(() => closed);
      }),
    );
  });
  await opened;
  return { use: <A, E>(f: (ws: Workspace) => Effect.Effect<A, E>) => run(f(workspace)), close };
};

const ids = (root: string) =>
  run(Effect.flatMap(makeWorkspace("check", root), (ws) => ws.snapshot)).then((snapshot) => ({
    ids: snapshot.tasks.map((task) => task.id).toSorted(),
    diagnostics: snapshot.diagnostics.map((diagnostic) => diagnostic.message),
  }));

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `HM-${index + 1}`).toSorted();

describe("task ids across processes", () => {
  it("never hands out an id twice when two processes create tasks at once", async () => {
    const root = await fresh();
    const [first, second] = await Promise.all([
      octodo(root, "create:15").exited,
      octodo(root, "create:15").exited,
    ]);
    expect([first.stderr, second.stderr]).toEqual(["", ""]);
    const created = [...first.ids, ...second.ids];
    expect(created.toSorted()).toEqual(numbered(30));
    expect(await ids(root)).toEqual({ ids: numbered(30), diagnostics: [] });
    for (const id of created) {
      const folder = readdirSync(join(root, ".octodo")).find((name) => name.startsWith(`${id}-`));
      expect(read(root, `${folder}/task.md`)).toContain(`id: ${id}\n`);
    }
  });

  it("lets only the holder write: another process waits for the lock, then writes after it", async () => {
    const root = await fresh();
    const holder = octodo(root, "create", "pause");
    await holder.paused;
    const waiting = octodo(root, "create");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(waiting.running(), "the second create waits while the first holds the lock").toBe(true);
    expect(await ids(root), "a read needs no lock").toEqual({ ids: [], diagnostics: [] });
    holder.resume();
    const [first, second] = await Promise.all([holder.exited, waiting.exited]);
    expect([first.ids, second.ids]).toEqual([["HM-1"], ["HM-2"]]);
    expect(await ids(root)).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
  });

  it("reports that another octodo is writing once it has waited long enough", async () => {
    const root = await fresh();
    const holder = octodo(root, "create", "pause");
    await holder.paused;
    const error = await run(
      Effect.flatMap(makeWorkspace("impatient", root, { lockWait: "200 millis" }), (ws) =>
        Effect.flip(ws.createTask({ title: "Impatient" })),
      ),
    );
    holder.resume();
    await holder.exited;
    expect(error).toMatchObject({
      _tag: "WorkspaceBusy",
      message: `Another octodo process is writing ${root}; try again when it is done`,
    });
    expect(await ids(root)).toEqual({ ids: ["HM-1"], diagnostics: [] });
  });

  it("takes over the lock of a holder killed with SIGKILL, and cleans up after it", async () => {
    const root = await fresh();
    crash(root, "create");
    expect(leftovers(root), "the crash leaves its new folder").not.toEqual([]);
    const started = Date.now();
    const created = await run(
      Effect.flatMap(makeWorkspace("cli", root, { lockWait: "1 second" }), (ws) =>
        ws.createTask({ title: "Next" }),
      ),
    );
    expect(Date.now() - started, "the lock is free at once").toBeLessThan(1000);
    expect(created.id).toBe("HM-1");
    expect(leftovers(root)).toEqual([]);
    expect(await ids(root)).toEqual({ ids: ["HM-1"], diagnostics: [] });
  });

  it("gives a hand-made file its id after a process died giving it one", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    crash(root, "read");
    expect(read(root, "milk/task.md"), "the crash came before the id was written").toBe(
      "Buy milk\n",
    );
    const created = await run(
      Effect.flatMap(makeWorkspace("cli", root), (ws) => ws.createTask({ title: "New" })),
    );
    expect(read(root, "milk/task.md")).toMatch(/^---\nid: HM-1\n/);
    expect(created.id).toBe("HM-2");
    expect(leftovers(root)).toEqual([]);
    expect(await ids(root)).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
  });

  it("never gives a new task an id that another process created since this one last read", async () => {
    const root = await fresh();
    const app = await openApp(root);
    await app.use((ws) => ws.snapshot);
    const cli = await octodo(root, "create").exited;
    const fromApp = await app.use((ws) => ws.createTask({ title: "From the app" }));
    app.close();
    expect(cli.ids).toEqual(["HM-1"]);
    expect(fromApp.id).toBe("HM-2");
    expect(await ids(root)).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
  });

  it("gives distinct ids to creates that run at the same time in separate workspaces", async () => {
    const root = await fresh();
    const creates = Array.from({ length: 12 }, (_, index) =>
      run(
        Effect.flatMap(makeWorkspace(`p${index}`, root), (ws) =>
          ws.createTask({ title: `Task ${index}` }),
        ),
      ),
    );
    const created = (await Promise.all(creates)).map((task) => task.id);
    expect(created.toSorted()).toEqual(numbered(12));
    expect(await ids(root)).toEqual({ ids: numbered(12), diagnostics: [] });
    expect(leftovers(root)).toEqual([]);
  });

  it("gives a hand-made file one id when several workspaces read it at once, and two files two ids", async () => {
    const root = await fresh();
    write(root, "milk/task.md", "Buy milk\n");
    write(root, "bread/task.md", "Buy bread\n");
    const reads = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        run(Effect.flatMap(makeWorkspace(`p${index}`, root), (ws) => ws.snapshot)),
      ),
    );
    const milk = /id: (HM-\d+)/.exec(read(root, "milk/task.md"))![1];
    const bread = /id: (HM-\d+)/.exec(read(root, "bread/task.md"))![1];
    expect(new Set([milk, bread])).toEqual(new Set(["HM-1", "HM-2"]));
    for (const snapshot of reads) {
      const byTitle = Object.fromEntries(snapshot.tasks.map((task) => [task.title, task.id]));
      expect(byTitle).toEqual({ Milk: milk, Bread: bread });
    }
    expect(read(root, "milk/task.md")).toBe(`---\nid: ${milk}\n---\n\nBuy milk\n`);
  });

  it("gives a file whose id is null or ~ an id in one read", { timeout: 3000 }, async () => {
    const root = await fresh();
    write(root, "milk/task.md", "---\nid: null\n---\n\nBuy milk\n");
    write(root, "bread/task.md", "---\nid: ~\n---\n\nBuy bread\n");
    const onDisk = await ids(root);
    expect(onDisk).toEqual({ ids: ["HM-1", "HM-2"], diagnostics: [] });
    expect(read(root, "bread/task.md")).toMatch(/^---\nid: HM-\d\n---\n\nBuy bread\n$/);
  });

  it("never gives a fixed copy the id of a task another workspace creates at the same time", async () => {
    const root = await fresh();
    write(root, "HM-1-a/task.md", "---\nid: HM-1\n---\n");
    for (const copy of ["b", "c", "d", "e"])
      write(root, `HM-1-${copy}/task.md`, "---\nid: HM-1\n---\n");
    const [fixed, ...created] = await Promise.all([
      run(Effect.flatMap(makeWorkspace("app", root), (ws) => ws.fixAll)),
      ...Array.from({ length: 8 }, (_, index) =>
        run(
          Effect.flatMap(makeWorkspace(`cli${index}`, root), (ws) =>
            ws.createTask({ title: `Task ${index}` }),
          ),
        ),
      ),
    ]);
    expect(fixed.failed).toEqual([]);
    expect(created).toHaveLength(8);
    expect(await ids(root)).toEqual({ ids: numbered(1 + 4 + 8), diagnostics: [] });
  });
});
