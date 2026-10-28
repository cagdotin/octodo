import { Effect, Option, Schema, SchemaAST } from "effect";
import { CLI_ANNOTATION, CliField } from "@octodo/contract/catalog";
import { Argument, CliError, Flag, type Param } from "effect/cli";

/** What one parsed param holds: none when it was not given. A clear flag holds `null`. */
type Slot = Option.Option<unknown>;

type SlotParam = Param.Param<Param.ParamKind, Slot>;

/** The command-line shape of a schema: its params for `Command.make`, and the way back. */
export interface SchemaFlags<A> {
  readonly params: Readonly<Record<string, SlotParam>>;
  /** The parsed params as the schema's type; the schema's own messages when they don't decode. */
  readonly decode: (
    parsed: Readonly<Record<string, Slot>>,
  ) => Effect.Effect<A, CliError.ValidationError>;
}

type ValueKind =
  | { readonly _tag: "text" }
  | { readonly _tag: "number" }
  | { readonly _tag: "boolean" }
  | { readonly _tag: "choice"; readonly choices: ReadonlyArray<string> }
  | { readonly _tag: "list" };

interface Field {
  readonly key: string;
  readonly name: string;
  readonly kind: ValueKind;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly cli: CliField;
  readonly description: string | undefined;
}

const unsupported = (key: string, why: string) =>
  new Error(`Field "${key}" has no command-line form: ${why}`);

const kebab = (key: string) =>
  key
    .replaceAll("_", "-")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

const isStringLiteral = (
  ast: SchemaAST.AST,
): ast is SchemaAST.Literal & { readonly literal: string } =>
  SchemaAST.isLiteral(ast) && typeof ast.literal === "string";

const choice = (values: ReadonlyArray<SchemaAST.AST>): ValueKind | undefined =>
  values.every(isStringLiteral)
    ? { _tag: "choice", choices: values.map((member) => member.literal) }
    : undefined;

/** The kind shared by `values`, the members of a field's type other than null and undefined. */
const kindOf = (values: ReadonlyArray<SchemaAST.AST>): ValueKind | undefined => {
  const [value, ...others] = values;
  if (value === undefined) return undefined;
  if (others.length > 0) return choice(values);
  if (SchemaAST.isString(value)) return { _tag: "text" };
  if (SchemaAST.isNumber(value)) return { _tag: "number" };
  if (SchemaAST.isBoolean(value)) return { _tag: "boolean" };
  if (SchemaAST.isUnion(value)) return choice(value.types);
  if (isStringLiteral(value)) return choice([value]);
  const isStringArray =
    SchemaAST.isArrays(value) &&
    value.elements.length === 0 &&
    value.rest.length === 1 &&
    value.rest.every(SchemaAST.isString);
  return isStringArray ? { _tag: "list" } : undefined;
};

const valueKind = (key: string, values: ReadonlyArray<SchemaAST.AST>): ValueKind => {
  const kind = kindOf(values);
  if (kind === undefined)
    throw unsupported(key, "it is not a string, number, boolean, string literals or string array");
  return kind;
};

const field = (key: string, ast: SchemaAST.AST): Field => {
  const members = SchemaAST.isUnion(ast) ? ast.types : [ast];
  const isAbsent = (member: SchemaAST.AST) =>
    SchemaAST.isNull(member) || SchemaAST.isUndefined(member);
  const cliField = Schema.decodeUnknownOption(CliField)(SchemaAST.resolve(ast)?.[CLI_ANNOTATION]);
  return {
    key,
    name: kebab(key),
    kind: valueKind(
      key,
      members.filter((member) => !isAbsent(member)),
    ),
    optional: SchemaAST.isOptional(ast),
    nullable: members.some(SchemaAST.isNull),
    cli: Option.getOrElse(cliField, () => ({})),
    description: SchemaAST.resolveDescription(ast),
  };
};

/** The items of one `--tags a,b` occurrence, without empty ones; `--tags ""` clears the list. */
const listItems = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const scalarFlag = (
  name: string,
  kind: Exclude<ValueKind, { _tag: "list" }>,
): Flag.Flag<unknown> => {
  switch (kind._tag) {
    case "text":
      return Flag.String(name);
    case "number":
      return Flag.Finite(name);
    case "boolean":
      return Flag.Boolean(name);
    case "choice":
      return Flag.Literals(name, kind.choices);
  }
};

const argumentOf = ({ key, name, kind }: Field): Argument.Argument<unknown> => {
  switch (kind._tag) {
    case "text":
      return Argument.String(name);
    case "number":
      return Argument.Finite(name);
    case "choice":
      return Argument.Literals(name, kind.choices);
    case "boolean":
    case "list":
      throw unsupported(key, `a ${kind._tag} cannot be positional`);
  }
};

const positionalParam = (spec: Field): SlotParam => {
  if (spec.nullable) throw unsupported(spec.key, "a positional argument cannot be cleared");
  const argument =
    spec.description === undefined
      ? argumentOf(spec)
      : Argument.withDescription(argumentOf(spec), spec.description);
  return spec.optional ? Argument.optional(argument) : Argument.map(argument, Option.some);
};

const described = <A>(spec: Field, flag: Flag.Flag<A>): Flag.Flag<A> =>
  flag.pipe(
    (self) =>
      spec.description === undefined ? self : Flag.withDescription(self, spec.description),
    (self) => (spec.cli.alias === undefined ? self : Flag.withAlias(self, spec.cli.alias)),
  );

/** A list's items come as repeated flags, comma lists or both, which its help says. */
const asList = (spec: Field): Field => ({
  ...spec,
  description: [spec.description, "repeat it or separate with commas"]
    .filter((part) => part !== undefined)
    .join("; "),
});

const flagParam = (spec: Field): SlotParam => {
  const mayBeAbsent = spec.optional || spec.nullable;
  const { kind } = spec;
  if (kind._tag === "list")
    return described(asList(spec), Flag.String(spec.name)).pipe(
      Flag.atLeast(0),
      Flag.map((values) =>
        mayBeAbsent && values.length === 0 ? Option.none() : Option.some(values.flatMap(listItems)),
      ),
    );
  const flag = described(spec, scalarFlag(spec.name, kind));
  if (mayBeAbsent) return Flag.optional(flag);
  if (kind._tag === "boolean") return flag.pipe(Flag.withDefault(false), Flag.map(Option.some));
  return Flag.map(flag, Option.some);
};

/** `--no-<name>`, which sets a nullable field to null. */
const clearParam = (spec: Field): SlotParam =>
  Flag.Boolean(`no-${spec.name}`).pipe(
    Flag.withoutNegation,
    Flag.withDescription(spec.cli.clear ?? `Clear --${spec.name}`),
    Flag.withDefault(false),
    Flag.map((clear) => (clear ? Option.some(null) : Option.none())),
  );

const clearKey = (key: string) => `${key}:clear`;

/**
 * The flags and positional arguments for a flat struct, one per field (a nullable field also gets
 * `--no-<name>`), and a decoder from what they parse back through the schema.
 */
export const schemaFlags = <Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields>,
): SchemaFlags<Schema.Struct<Fields>["Type"]> => {
  const fields = Object.entries(schema.fields).map(([key, member]) => field(key, member.ast));
  const params: Record<string, SlotParam> = {};
  for (const spec of fields) {
    params[spec.key] = spec.cli.positional === true ? positionalParam(spec) : flagParam(spec);
    if (spec.nullable) params[clearKey(spec.key)] = clearParam(spec);
  }
  // An operation's input needs no services to decode: it is plain data.
  const decodeInput = Schema.decodeUnknownEffect(
    schema as Schema.Struct<Fields> & Schema.Decoder<Schema.Struct<Fields>["Type"]>,
  );
  const decode = (parsed: Readonly<Record<string, Slot>>) =>
    Effect.gen(function* () {
      const input: Record<string, unknown> = {};
      for (const spec of fields) {
        const value = parsed[spec.key] ?? Option.none();
        const clear = parsed[clearKey(spec.key)] ?? Option.none();
        if (Option.isSome(value) && Option.isSome(clear))
          return yield* new CliError.ValidationError({
            message: `Give --${spec.name} or --no-${spec.name}, not both`,
          });
        const given = Option.orElse(value, () => clear);
        if (Option.isSome(given)) input[spec.key] = given.value;
      }
      return yield* decodeInput(input, { errors: "all" }).pipe(
        Effect.mapError((error) => new CliError.ValidationError({ message: error.message })),
      );
    });
  return { params, decode };
};
