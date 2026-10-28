/**
 * Times the Workspace operations a person waits on, on generated 1k- and 5k-task workspaces in a
 * temporary folder. Results and how to read them: docs/research/perf-baseline.md.
 *
 *   node scripts/bench/workspace.ts [--sizes 1000,5000] [--runs 7] [--keep]
 */
import { NodeServices } from "@effect/platform-node";
import { Effect, Stream } from "effect";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { initWorkspace, makeWorkspace, type Workspace } from "../../packages/engine/src/index.ts";

const KEY = "BN";
const STATUSES = ["backlog", "todo", "in-progress", "done", "archived"];
const LISTS = ["inbox", "home", "work", "work/clients", "work/clients/acme", "errands", "reading"];
const WORDS = "paint fence order seeds call plumber draft report fix leak plan trip book review"
  .split(" ")
  .concat("garden invoice email budget renew passport clean garage water plants".split(" "));

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<A, E>,
  );

/** Deterministic, so every run of the script generates the same workspace. */
const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** The i-th fractional-indexing key among siblings: `b00`, `b01`, ... (up to 3,844 siblings). */
const orderKey = (index: number) => `b${BASE62[Math.floor(index / 62)]}${BASE62[index % 62]}`;

interface TaskPlan {
  readonly n: number;
  readonly dir: string;
  readonly title: string;
}

/** Writes `size` tasks straight to disk in the documented format: 30% at the top, 10% subtasks. */
const generate = async (root: string, size: number) => {
  await run(initWorkspace(root, { name: "Bench", key: KEY }));
  const tasksDir = join(root, ".octodo", "tasks");
  const next = random(size);
  const pick = <A>(items: ReadonlyArray<A>) => items[Math.floor(next() * items.length)]!;
  for (const [index, list] of LISTS.entries()) {
    await mkdir(join(tasksDir, list));
    await writeFile(
      join(tasksDir, list, "list.md"),
      `---\nname: ${list.split("/").at(-1)}\norder: ${orderKey(index)}\n---\n`,
    );
  }
  const siblings = new Map<string, number>();
  const tasks: Array<TaskPlan> = [];
  for (let n = 1; n <= size; n++) {
    const title = `${pick(WORDS)} ${pick(WORDS)} ${n}`;
    const parent = tasks.length > 20 && next() < 0.1 ? pick(tasks) : undefined;
    const container = parent?.dir ?? (next() < 0.3 ? tasksDir : join(tasksDir, pick(LISTS)));
    const index = siblings.get(container) ?? 0;
    siblings.set(container, index + 1);
    const dir = join(container, `${KEY}-${n}-${title.replaceAll(" ", "-")}`);
    const lines = [
      `id: ${KEY}-${n}`,
      `title: ${title}`,
      `status: ${pick(STATUSES)}`,
      `order: ${orderKey(index)}`,
      `priority: ${pick(["none", "low", "medium", "high", "urgent"])}`,
      `created: 2026-0${1 + (n % 9)}-1${n % 10}T09:00:00.000Z`,
    ];
    if (next() < 0.2) lines.push(`due: 2026-1${n % 3}-0${1 + (n % 9)}`);
    if (next() < 0.5) lines.push("tags:", `  - ${pick(WORDS)}`, `  - ${pick(WORDS)}`);
    if (n > 10 && next() < 0.05)
      lines.push(`blocked_by: [${KEY}-${1 + Math.floor(next() * (n - 1))}]`);
    const body =
      next() < 0.6
        ? ""
        : `\n${pick(WORDS)} the ${pick(WORDS)} before the ${pick(WORDS)}, see [[${KEY}-${1 + Math.floor(next() * n)}]].\n`;
    await mkdir(dir);
    await writeFile(join(dir, "task.md"), `---\n${lines.join("\n")}\n---\n${body}`);
    tasks.push({ n, dir, title });
  }
};

const elapsed = (start: number) => performance.now() - start;

/** Opens the workspace with a watcher and reads it once, in this process. */
const open = (root: string) =>
  run(
    Effect.gen(function* () {
      const start = performance.now();
      const workspace = yield* makeWorkspace("bench", root, { watch: true });
      const snapshot = yield* workspace.snapshot;
      return {
        ms: elapsed(start),
        tasks: snapshot.tasks.length,
        diagnostics: snapshot.diagnostics.length,
      };
    }),
  );

/** A fresh Node process per open, so no JIT or module cache carries over. The OS file cache does. */
const coldOpen = (root: string) => {
  const child = spawnSync(process.execPath, [import.meta.filename, "--open", root], {
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(`cold open failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as Awaited<ReturnType<typeof open>>;
};

type Operation = "status change" | "rename" | "create" | "hand edit seen";
const IDLE = "2 seconds";
const OPERATIONS: ReadonlyArray<Operation> = [
  "status change",
  "rename",
  "create",
  "hand edit seen",
];

/**
 * Times each operation `runs` times after one warm-up round, interleaved so drift hits all of
 * them alike, and checks the files and the snapshot after each. Before each operation the
 * watcher has gone quiet and the process has idled for `IDLE`, as between two clicks: an
 * operation run straight after another measured up to 40% faster, so without the pause the
 * numbers depended on which operation came before.
 */
const operations = (root: string, runs: number) =>
  run(
    Effect.gen(function* () {
      const workspace: Workspace = yield* makeWorkspace("bench", root, { watch: true });
      let events = 0;
      yield* workspace.changes.pipe(
        Stream.runForEach(() => Effect.sync(() => events++)),
        Effect.forkScoped,
      );
      const eventAfter = (seen: number, timeoutMs: number) =>
        Effect.gen(function* () {
          const start = performance.now();
          while (events === seen) {
            if (elapsed(start) > timeoutMs) return false;
            yield* Effect.sleep("1 millis");
          }
          return true;
        });
      const settle = Effect.gen(function* () {
        let seen = events;
        while (yield* eventAfter(seen, 300)) seen = events;
        yield* workspace.snapshot;
        yield* Effect.sleep(IDLE);
      });
      const check = (ok: boolean, what: string) => {
        if (!ok) throw new Error(`${what} did not happen`);
      };
      const taskFile = (path: string) => readFile(join(root, path), "utf8");

      let round = 0;
      const once: Record<Operation, Effect.Effect<number, unknown>> = {
        "status change": Effect.gen(function* () {
          const [task] = (yield* workspace.snapshot).tasks.filter((t) => t.status === "todo");
          const start = performance.now();
          const moved = yield* workspace.moveTask(task!.id, { status: "in-progress" });
          const ms = elapsed(start);
          const file = yield* Effect.promise(() => taskFile(moved.path));
          check(moved.status === "in-progress" && file.includes("status: in-progress"), "status");
          return ms;
        }),
        rename: Effect.gen(function* () {
          const task = (yield* workspace.snapshot).tasks[round * 7]!;
          const title = `renamed ${round} ${task.title}`;
          const start = performance.now();
          const renamed = yield* workspace.updateTask(task.id, { title });
          const ms = elapsed(start);
          const file = yield* Effect.promise(() => taskFile(renamed.path));
          check(renamed.path !== task.path && file.includes(`title: ${title}`), "rename");
          return ms;
        }),
        create: Effect.gen(function* () {
          const before = (yield* workspace.snapshot).tasks.length;
          const start = performance.now();
          const created = yield* workspace.createTask({ title: `created ${round}`, list: "work" });
          const ms = elapsed(start);
          const after = (yield* workspace.snapshot).tasks.length;
          const file = yield* Effect.promise(() => taskFile(created.path));
          check(after === before + 1 && file.includes(`id: ${created.id}`), "create");
          return ms;
        }),
        "hand edit seen": Effect.gen(function* () {
          const task = (yield* workspace.snapshot).tasks[round * 7 + 3]!;
          const title = `edited by hand ${round}`;
          const text = yield* Effect.promise(() => taskFile(task.path));
          const seen = events;
          const start = performance.now();
          yield* Effect.promise(() =>
            writeFile(join(root, task.path), text.replace(/^title: .*$/m, `title: ${title}`)),
          );
          const titleNow = Effect.map(
            workspace.getTask(task.id),
            (current) => current.title === title,
          );
          check(yield* eventAfter(seen, 5_000), "the watcher event");
          while (!(yield* titleNow)) check(yield* eventAfter(events, 5_000), "the hand edit");
          return elapsed(start);
        }),
      };

      const times = new Map<Operation, Array<number>>(OPERATIONS.map((op) => [op, []]));
      for (round = 0; round <= runs; round++) {
        for (const op of OPERATIONS) {
          yield* settle;
          const ms = yield* once[op];
          if (round > 0) times.get(op)!.push(ms);
        }
      }
      return times;
    }),
  );

const summary = (samples: ReadonlyArray<number>) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2 === 1
      ? sorted[Math.floor(middle)]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const ms = (value: number) => `${Math.round(value)}`;
  return `${ms(median)} | ${ms(sorted[0]!)} to ${ms(sorted.at(-1)!)}`;
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string", default: "1000,5000" },
      runs: { type: "string", default: "7" },
      keep: { type: "boolean", default: false },
      open: { type: "string" },
    },
  });
  if (values.open !== undefined) {
    process.stdout.write(JSON.stringify(await open(values.open)));
    return;
  }
  const runs = Number(values.runs);
  const scratch = await mkdtemp(join(tmpdir(), "octodo-bench-"));
  process.env["OCTODO_HOME"] = join(scratch, "home");
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  console.log(
    `commit ${commit}, node ${process.version}, ${runs} runs per number, in ${scratch}\n`,
  );
  console.log("| tasks | operation | median ms | range ms |\n| --- | --- | --- | --- |");
  try {
    for (const size of values.sizes.split(",").map(Number)) {
      const root = join(scratch, `workspace-${size}`);
      await mkdir(root);
      await generate(root, size);
      const opens = Array.from({ length: runs + 1 }, () => coldOpen(root)).slice(1);
      const first = opens[0]!;
      if (first.tasks !== size || first.diagnostics !== 0)
        throw new Error(`read ${first.tasks} tasks and ${first.diagnostics} diagnostics`);
      console.log(`| ${size} | cold open | ${summary(opens.map((o) => o.ms))} |`);
      for (const [op, samples] of await operations(root, runs))
        console.log(`| ${size} | ${op} | ${summary(samples)} |`);
    }
  } finally {
    if (!values.keep) await rm(scratch, { recursive: true, force: true });
  }
};

await main();
