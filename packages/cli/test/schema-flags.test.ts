import { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "@octodo/contract";
import { Effect, FileSystem, Layer, Path, Schema, Stdio, Terminal } from "effect";
import { CliError, Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";
import { cli, schemaFlags } from "../src/schema-flags.ts";

const TestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  TestConsole.layer,
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
);

type Outcome = { readonly input: unknown } | { readonly errors: ReadonlyArray<string> };

/** Runs `octo <argv>` with a command generated from `schema`, wired as the catalog will wire it. */
const octo = <Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields> & Schema.Decoder<Schema.Struct<Fields>["Type"]>,
  argv: ReadonlyArray<string>,
) => {
  const flags = schemaFlags(schema);
  const received: Array<unknown> = [];
  const command = Command.make("octo", { input: flags.params }, ({ input }) =>
    Effect.map(flags.decode(input), (decoded) => {
      received.push(decoded);
    }),
  ).pipe(Command.validate(({ input }) => Effect.asVoid(flags.decode(input))));
  return Effect.runPromise(
    Command.runWith(command, { version: "0.0.0", renderErrors: false })(argv).pipe(
      Effect.map((): Outcome => ({ input: received[0] })),
      Effect.catchTag("ShowHelp", (help) =>
        Effect.succeed<Outcome>({ errors: help.errors.map((error) => error.message) }),
      ),
      Effect.provide(TestLayer),
    ),
  );
};

const help = <Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields> & Schema.Decoder<Schema.Struct<Fields>["Type"]>,
) =>
  Effect.runPromise(
    Command.runWith(Command.make("octo", { input: schemaFlags(schema).params }), {
      version: "0.0.0",
    })(["--help"]).pipe(
      Effect.andThen(TestConsole.logLines),
      Effect.map((lines) => lines.join("\n")),
      Effect.provide(TestLayer),
    ),
  );

const positional = cli({ positional: true });
const TaskId = Schema.String.annotate({ description: "Task id, e.g. HM-42", ...positional });

const CreateTask = Schema.Struct({
  ...CreateTaskInput.fields,
  title: CreateTaskInput.fields.title.annotate(positional),
  status: CreateTaskInput.fields.status.annotate(cli({ alias: "s" })),
  list: CreateTaskInput.fields.list.annotate({
    description: "List id, e.g. groceries or garden/seeds",
    ...cli({ alias: "l" }),
  }),
  priority: CreateTaskInput.fields.priority.annotate(cli({ alias: "p" })),
  tags: CreateTaskInput.fields.tags.annotate(cli({ alias: "t" })),
});

const UpdateTask = Schema.Struct({
  id: TaskId,
  ...UpdateTaskInput.fields,
  priority: UpdateTaskInput.fields.priority.annotate(cli({ alias: "p" })),
  tags: UpdateTaskInput.fields.tags.annotate(cli({ alias: "t" })),
});

const MoveTask = Schema.Struct({
  id: TaskId,
  ...MoveTaskInput.fields,
  status: MoveTaskInput.fields.status.annotate(positional),
});

const ListTasks = Schema.Struct({
  status: Schema.optionalKey(Schema.String).annotate(cli({ alias: "s" })),
  list: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate(cli({ alias: "l" })),
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tag: Schema.optionalKey(Schema.String).annotate(cli({ alias: "t" })),
  query: Schema.optionalKey(Schema.String),
  all: Schema.optionalKey(Schema.Boolean).annotate(cli({ alias: "a" })),
  ready: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Only tasks that can start now: open and not blocked",
  }),
});

describe("create task flags", () => {
  it("parse today's create examples", async () => {
    expect(await octo(CreateTask, ["Book the movers", "-p", "high", "-t", "quotes"])).toEqual({
      input: { title: "Book the movers", priority: "high", tags: ["quotes"] },
    });
    expect(await octo(CreateTask, ["Buy primer", "--parent", "HM-12"])).toEqual({
      input: { title: "Buy primer", parent: "HM-12" },
    });
  });

  it("take every field", async () => {
    const argv = ["Paint", "-s", "todo", "-l", "home", "-p", "low", "-t", "a,b"];
    expect(await octo(CreateTask, [...argv, "--due", "2026-11-01", "--body", "Two coats"])).toEqual(
      {
        input: {
          title: "Paint",
          status: "todo",
          list: "home",
          priority: "low",
          tags: ["a", "b"],
          due: "2026-11-01",
          body: "Two coats",
        },
      },
    );
  });

  it("take a list as repeated flags, comma lists or both", async () => {
    expect(await octo(CreateTask, ["Paint", "-t", "a", "--tags", "b,c"])).toEqual({
      input: { title: "Paint", tags: ["a", "b", "c"] },
    });
  });

  it("leave out what was not given", async () => {
    expect(await octo(CreateTask, ["Paint"])).toEqual({ input: { title: "Paint" } });
  });

  it("clear a nullable field with --no-<name>", async () => {
    expect(await octo(CreateTask, ["Paint", "--no-due", "--no-list"])).toEqual({
      input: { title: "Paint", due: null, list: null },
    });
  });

  it("report the schema's own messages", async () => {
    expect(await octo(CreateTask, ["", "--due", "2026-13-01"])).toEqual({
      errors: [
        'Expected a value with a length of at least 1\n  at ["title"]\nUse a date such as 2026-11-01, or a date and time such as 2026-11-01T10:00\n  at ["due"]',
      ],
    });
  });

  it("offer a literal field's values as choices", async () => {
    const outcome = await octo(CreateTask, ["Paint", "-p", "extreme"]);
    expect(outcome).toMatchObject({ errors: [expect.stringContaining("urgent")] });
  });

  it("require a required positional", async () => {
    expect(await octo(CreateTask, [])).toMatchObject({ errors: [expect.any(String)] });
  });

  it("show descriptions as help", async () => {
    const text = await help(CreateTask);
    expect(text).toContain("List id, e.g. groceries or garden/seeds");
    expect(text).toContain("--no-due");
  });
});

describe("update task flags", () => {
  it("parse today's blocked-by examples", async () => {
    expect(await octo(UpdateTask, ["HM-4", "--blocked-by", "HM-2,HM-3"])).toEqual({
      input: { id: "HM-4", blocked_by: ["HM-2", "HM-3"] },
    });
    expect(await octo(UpdateTask, ["HM-4", "--blocked-by", ""])).toEqual({
      input: { id: "HM-4", blocked_by: [] },
    });
  });

  it("change title, priority and due date", async () => {
    const argv = ["HM-4", "--title", "Repaint", "-p", "urgent", "--due", "2026-11-01T10:00"];
    expect(await octo(UpdateTask, argv)).toEqual({
      input: { id: "HM-4", title: "Repaint", priority: "urgent", due: "2026-11-01T10:00" },
    });
  });

  it("reject a value and its clear together", async () => {
    expect(await octo(UpdateTask, ["HM-4", "--due", "2026-11-01", "--no-due"])).toEqual({
      errors: ["Give --due or --no-due, not both"],
    });
  });
});

describe("move task flags", () => {
  it("take the status as an optional second positional", async () => {
    expect(await octo(MoveTask, ["HM-4", "in-progress"])).toEqual({
      input: { id: "HM-4", status: "in-progress" },
    });
    expect(await octo(MoveTask, ["HM-4", "--list", "garden/seeds", "--before", "HM-2"])).toEqual({
      input: { id: "HM-4", list: "garden/seeds", before: "HM-2" },
    });
  });

  it("lift out of a list or a parent", async () => {
    expect(await octo(MoveTask, ["HM-4", "--no-list"])).toEqual({
      input: { id: "HM-4", list: null },
    });
    expect(await octo(MoveTask, ["HM-4", "done", "--no-parent", "--after", "HM-9"])).toEqual({
      input: { id: "HM-4", status: "done", parent: null, after: "HM-9" },
    });
  });
});

describe("list filter flags", () => {
  it("parse today's list flags", async () => {
    const argv = ["-s", "todo", "-l", "home", "-t", "paint", "-a", "--ready"];
    expect(await octo(ListTasks, argv)).toEqual({
      input: { status: "todo", list: "home", tag: "paint", all: true, ready: true },
    });
  });

  it("leave optional booleans out unless given, and take their negation", async () => {
    expect(await octo(ListTasks, [])).toEqual({ input: {} });
    expect(await octo(ListTasks, ["--no-ready"])).toEqual({ input: { ready: false } });
  });
});

describe("schemaFlags", () => {
  it("names a field's flag in kebab case and parses numbers", async () => {
    const Limits = Schema.Struct({ maxCount: Schema.Number, dry_run: Schema.Boolean });
    expect(await octo(Limits, ["--max-count", "3", "--dry-run"])).toEqual({
      input: { maxCount: 3, dry_run: true },
    });
    expect(await octo(Limits, ["--max-count", "3"])).toEqual({
      input: { maxCount: 3, dry_run: false },
    });
  });

  it("refuses a field with no command-line form", () => {
    expect(() =>
      schemaFlags(Schema.Struct({ nested: Schema.Struct({ a: Schema.String }) })),
    ).toThrow('Field "nested"');
    expect(() =>
      schemaFlags(Schema.Struct({ due: Schema.NullOr(Schema.String).annotate(positional) })),
    ).toThrow('Field "due"');
  });

  it("fails decoding with a CLI validation error", async () => {
    const flags = schemaFlags(CreateTask);
    const error = await Effect.runPromise(Effect.flip(flags.decode({})));
    expect(error).toBeInstanceOf(CliError.ValidationError);
  });
});
