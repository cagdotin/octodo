import { FixAction, InvalidRequest, type Diagnostic } from "@octodo/contract";
import { isProblem } from "@octodo/contract/rules";
import { Workspaces, defaultHome, makeRegistry } from "@octodo/engine";
import { stdioLayer } from "@octodo/mcp";
import { plugins } from "@octodo/plugins";
import { DEFAULT_PORT, startServer } from "@octodo/server";
import { Console, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { json, operationCommands } from "./commands.ts";
import { SKILL } from "./skill.ts";

export const home = defaultHome(process.env, homedir());

const root = Command.make("octo").pipe(
  Command.withSharedFlags({
    workspace: Flag.String("workspace").pipe(
      Flag.withAlias("w"),
      Flag.withDescription(
        "Workspace id or folder; defaults to the one containing the current directory",
      ),
      Flag.optional,
    ),
  }),
  Command.withDescription("Tasks as markdown files, managed from the terminal"),
);

/** The folder `--workspace` names, or the current directory. */
const target = Effect.map(root, (flags) => Option.getOrElse(flags.workspace, () => process.cwd()));

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The workspace named by `--workspace`, or the one containing the current directory. Prints what
 * its files have wrong on stderr, notes aside, and points at `octo doctor` when some of it can be
 * fixed.
 */
const workspace = Effect.gen(function* () {
  const ws = yield* (yield* Workspaces).open(yield* target);
  const problems = (yield* ws.snapshot).diagnostics.filter(isProblem);
  for (const diagnostic of problems)
    yield* Console.error(`warning: ${diagnostic.path}: ${diagnostic.message}`);
  if (problems.some((diagnostic) => diagnostic.fix?.inFixAll === true))
    yield* Console.error("Run `octo doctor --fix` to fix what octodo can.");
  else if (problems.some((diagnostic) => diagnostic.fix !== null))
    yield* Console.error("Run `octo doctor` to pick the fixes to apply.");
  return ws;
});

const generated = operationCommands(makeRegistry(plugins), workspace);

/** The generated commands run by `words`, which start with the group's name when it has one. */
const commandsIn = (...group: ReadonlyArray<string>) =>
  generated
    .filter(
      ({ words }) =>
        words.length === group.length + 1 && group.every((word, index) => words[index] === word),
    )
    .map(({ command }) => command);

const describeDiagnostic = (diagnostic: Diagnostic) =>
  [
    `${diagnostic.path}  [${diagnostic.kind}${diagnostic.field === null ? "" : ` ${diagnostic.field}`}]`,
    `  ${diagnostic.message}`,
    ...(diagnostic.fix === null
      ? []
      : [
          `  fix: ${diagnostic.fix.label} (octo doctor ${JSON.stringify(diagnostic.path)} --apply ${diagnostic.fix.action})`,
        ]),
  ].join("\n");

const doctorCommand = Command.make(
  "doctor",
  {
    path: Argument.String("path").pipe(
      Argument.withDescription("The path of one problem, for --apply"),
      Argument.optional,
    ),
    apply: Flag.Literals("apply", FixAction.literals).pipe(
      Flag.withDescription("Apply this fix to the problem at <path>, if octodo still offers it"),
      Flag.optional,
    ),
    fix: Flag.Boolean("fix").pipe(
      Flag.withDescription("Apply every fix octodo offers, then list what is left"),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (options) {
    const ws = yield* (yield* Workspaces).open(yield* target);
    const applyOne = (action: FixAction) =>
      Effect.gen(function* () {
        if (Option.isNone(options.path))
          return yield* new InvalidRequest({ message: "--apply needs the problem's path" });
        const path = options.path.value;
        const offered = (yield* ws.snapshot).diagnostics.find(
          (diagnostic) => diagnostic.path === path && diagnostic.fix?.action === action,
        );
        if (offered === undefined)
          return yield* new InvalidRequest({ message: `No problem at ${path} offers ${action}` });
        return yield* ws.fixDiagnostic({ path, kind: offered.kind, action });
      });
    const result = Option.isSome(options.apply)
      ? yield* applyOne(options.apply.value)
      : options.fix
        ? yield* ws.fixAll
        : { fixed: [], failed: [], diagnostics: (yield* ws.snapshot).diagnostics };
    const problems = result.diagnostics.filter(isProblem);
    if (problems.length > 0) process.exitCode = 1;
    if (options.json) return yield* Console.log(JSON.stringify(result, null, 2));
    for (const fixed of result.fixed)
      yield* Console.log(`fixed: ${fixed.path}: ${fixed.fix?.label ?? fixed.kind}`);
    for (const { diagnostic, error } of result.failed)
      yield* Console.error(`could not fix ${diagnostic.path}: ${error}`);
    if (result.diagnostics.length === 0) return yield* Console.log(`No problems in ${ws.root}`);
    if (result.fixed.length > 0 || result.failed.length > 0) yield* Console.log("");
    yield* Console.log(result.diagnostics.map(describeDiagnostic).join("\n\n"));
    const fixable = problems.filter((diagnostic) => diagnostic.fix?.inFixAll === true).length;
    const notes = result.diagnostics.length - problems.length;
    yield* Console.log(
      `\n${count(problems.length, "problem")}${notes > 0 ? ` and ${count(notes, "note")}` : ""}${fixable > 0 && !options.fix ? `; run \`octo doctor --fix\` to fix ${fixable}` : ""}`,
    );
  }),
).pipe(
  Command.withDescription(
    "List problems with the workspace's files, with what to do about each; --fix applies the safe fixes, <path> --apply <fix> one fix",
  ),
);

const initCommand = Command.make(
  "init",
  {
    dir: Argument.String("dir").pipe(Argument.withDefault(".")),
    name: Flag.String("name").pipe(Flag.optional),
    key: Flag.String("key").pipe(Flag.withDescription("Id prefix, e.g. CT"), Flag.optional),
  },
  Effect.fn(function* ({ dir, name, key }) {
    const info = yield* (yield* Workspaces).add(dir, {
      name: Option.getOrUndefined(name),
      key: Option.getOrUndefined(key),
    });
    yield* Console.log(
      `Workspace "${info.name}" (${info.key}) at ${info.root}, registered as ${info.id}`,
    );
  }),
).pipe(Command.withDescription("Create .octodo/ in a folder and register it"));

const workspaceCommand = Command.make("workspace").pipe(
  Command.withDescription("Manage registered workspaces"),
  Command.withSubcommands([
    ...commandsIn("workspace"),
    Command.make(
      "remove",
      { id: Argument.String("id") },
      Effect.fn(function* ({ id }) {
        yield* (yield* Workspaces).remove(id);
        yield* Console.log(`Unregistered ${id}; its files are untouched`);
      }),
    ).pipe(Command.withDescription("Forget a workspace without touching its files")),
  ]),
);

const listsCommand = Command.make("lists").pipe(
  Command.withDescription("Manage lists"),
  Command.withSubcommands(commandsIn("lists")),
);

const serveCommand = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(Flag.withDefault(DEFAULT_PORT)),
    webDir: Flag.String("web-dir").pipe(
      Flag.withDescription("Built web app to serve"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (options) {
    const defaultWeb = fileURLToPath(new URL("../../../apps/web/dist", import.meta.url));
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startServer({
          home,
          port: options.port,
          webDir: Option.getOrElse(options.webDir, () => defaultWeb),
        }),
      ),
      (running) => Effect.promise(() => running.close()),
    );
    yield* Console.log(`octodo on ${server.url}`);
    yield* Console.log(`MCP: ${server.mcpUrl}`);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(Command.withDescription("Serve the web app, API and MCP endpoint"));

const mcpCommand = Command.make(
  "mcp",
  {},
  Effect.fn(function* () {
    const flags = yield* root;
    const defaultDir = Option.getOrElse(flags.workspace, () => process.cwd());
    return yield* Layer.launch(
      stdioLayer({ defaultDir }).pipe(
        Layer.provide(Workspaces.layer({ home, watch: true, plugins })),
      ),
    );
  }),
).pipe(Command.withDescription("Run the MCP server over stdio, for agents"));

const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Agent skills"),
  Command.withSubcommands([
    Command.make(
      "export",
      {
        dir: Flag.String("dir").pipe(
          Flag.withDescription("Skills folder"),
          Flag.withDefault(".agents/skills"),
        ),
      },
      Effect.fn(function* ({ dir }) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = path.join(dir, "octodo");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "SKILL.md"), SKILL);
        yield* Console.log(`Wrote ${path.join(folder, "SKILL.md")}`);
      }),
    ).pipe(
      Command.withDescription(
        "Write the octodo skill so agents in this project know how to use it",
      ),
    ),
  ]),
);

export const octo = root.pipe(
  Command.withSubcommands([
    ...commandsIn(),
    doctorCommand,
    initCommand,
    workspaceCommand,
    listsCommand,
    serveCommand,
    mcpCommand,
    skillsCommand,
  ]),
);
