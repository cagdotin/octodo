import { Task, type AttachmentContent } from "@octodo/contract";
import {
  FileSuccess,
  type CliCommand,
  type Operation,
  type OperationName,
} from "@octodo/contract/catalog";
import type { Registry } from "@octodo/engine";
import { Console, Effect, FileSystem, Option, Schema, type PlatformError } from "effect";
import { Command, Flag } from "effect/cli";
import { line, renderers, type KindLabel } from "./render.ts";
import { schemaFlags } from "./schema-flags.ts";

/** Runs an operation by name on its decoded input, without the `workspace` field. */
export type RunOperation<E, R> = (name: string, input: object) => Effect.Effect<unknown, E, R>;

/**
 * A command generated from an operation, with the words that run it. Its types are stated here,
 * since it is built from the registry at runtime: it fails as `run` does, or as saving a file.
 */
export interface OperationCommand<E, R> {
  readonly words: CliCommand["command"];
  readonly command: Command.Command<
    string,
    unknown,
    {},
    E | PlatformError.PlatformError,
    R | FileSystem.FileSystem
  >;
}

export const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON"),
  Flag.withDefault(false),
);

const output = Flag.String("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Write the file here instead of to stdout"),
  Flag.optional,
);

/** Writes to stdout; a reader that has gone, as `| head` does, ends the output without a crash. */
const ignore = () => {};

/** Writes bytes to stdout; a reader that closes early (`| head`) ends the output, not the process. */
const writeStdout = (bytes: Uint8Array) =>
  Effect.callback<void>((resume) => {
    process.stdout.on("error", ignore);
    process.stdout.write(bytes, () => resume(Effect.void));
  });

/** Each task line's words from its kind's plugin. */
const kindLabel =
  (registry: Registry): KindLabel =>
  (kind) => {
    const label = registry.plugins.find((plugin) => plugin.shared.id === kind?.id)?.shared.label;
    return kind === undefined || label === undefined ? "" : label(kind.fields as never);
  };

type Render = (result: unknown, label: KindLabel) => ReadonlyArray<string>;

/** The operation's own renderer, or a task line for any operation, a plugin's too, giving a task. */
const rendererOf = (name: string, operation: Operation): Render | undefined =>
  (renderers[name as OperationName] as Render | undefined) ??
  (operation.success === Task ? (task, label) => [line(task as Task, label)] : undefined);

/**
 * Prints a success: the renderer's lines, or JSON when there is none or `--json` asks for it. The
 * JSON is the success as its schema encodes it, as MCP and HTTP send it, whichever process ran it.
 */
const print = (
  registry: Registry,
  operation: Operation,
  render: Render | undefined,
  result: unknown,
  asJson: boolean,
) => {
  if (render === undefined || asJson)
    return Console.log(
      JSON.stringify(
        Schema.encodeUnknownSync(
          Schema.toCodecJson(operation.success as Schema.Top) as unknown as Schema.Codec<
            unknown,
            unknown
          >,
        )(result),
        null,
        2,
      ),
    );
  return Effect.forEach(render(result, kindLabel(registry)), (text) => Console.log(text), {
    discard: true,
  });
};

const save = (file: AttachmentContent, to: Option.Option<string>) =>
  Option.match(to, {
    onNone: () => writeStdout(file.bytes),
    onSome: (path) =>
      Effect.andThen(
        Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFile(path, file.bytes)),
        Console.log(`Wrote ${file.path} to ${path}`),
      ),
  });

const commandFor = <E, R>(
  registry: Registry,
  name: string,
  operation: Operation,
  cli: CliCommand,
  run: RunOperation<E, R>,
) => {
  const { workspace: _selector, ...fields } = operation.input.fields;
  const flags = schemaFlags(Schema.Struct(fields));
  const isFile = operation.success === FileSuccess;
  const render = rendererOf(name, operation);
  // Every command that prints a value takes --json, so a script can always pass it.
  const extra = isFile ? { output } : { json };
  const command = Command.make(
    cli.command.at(-1)!,
    { input: flags.params, ...extra },
    Effect.fn(function* (parsed: {
      readonly input: Parameters<typeof flags.decode>[0];
      readonly json?: boolean;
      readonly output?: Option.Option<string>;
    }) {
      const input = yield* flags.decode(parsed.input);
      const result = yield* run(name, input);
      if (isFile) return yield* save(result as AttachmentContent, parsed.output ?? Option.none());
      yield* print(registry, operation, render, result, parsed.json === true);
    }),
  ).pipe(
    Command.validate(({ input }) => Effect.asVoid(flags.decode(input))),
    Command.withDescription(cli.description),
  );
  const aliased = (cli.aliases ?? []).reduce(
    (self, alias) => Command.withAlias(self, alias),
    command,
  );
  return cli.examples === undefined ? aliased : Command.withExamples(aliased, [...cli.examples]);
};

/**
 * One command for each operation with a `cli` entry. `run` runs it in the workspace the command
 * line names; the operation's `workspace` field is not a flag of its own.
 */
export const operationCommands = <E, R>(
  registry: Registry,
  run: RunOperation<E, R>,
): Array<OperationCommand<E, R>> =>
  Object.entries(registry.operations).flatMap(([name, operation]) =>
    operation.cli === undefined
      ? []
      : [
          {
            words: operation.cli.command,
            command: commandFor(
              registry,
              name,
              operation,
              operation.cli,
              run,
            ) as unknown as OperationCommand<E, R>["command"],
          },
        ],
  );
