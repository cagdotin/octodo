---
name: typescript-best-practices
description: TypeScript best practices for this repo, including Effect v4 and Schema idioms. Use when reading or editing any .ts or .tsx file.
paths: ["**/*.ts", "**/*.tsx"]
disable-model-invocation: true
---

# TypeScript best practices

Apply the **type-system-discipline** principle skill first.

## Repo constraints

These come from `AGENTS.md` and the toolchain. Break one and the code doesn't run or doesn't ship.

- **Erasable syntax only.** Node runs the TypeScript sources directly. No `enum`, no `namespace`, no parameter properties. Use `as const` arrays plus `Schema.Literals`, as `STATUS_CATEGORIES` (`packages/contract/src/rules.ts`) and `StatusCategory` (`domain.ts`) do.
- **Import with the `.ts` extension.** `import { TASK_FILE } from "./layout.ts"`.
- **The browser bundle imports only types from `@octodo/contract`**, plus `@octodo/contract/rules`, which is plain functions with no Effect, and never `@octodo/engine`. Lint fails anything else, since a value import from `domain.ts` pulls the Effect runtime into the web app.
- **Effect holds the logic, the HTTP layer stays thin.** HttpApi handlers call a service or `runOperation` and return its result; the API definition decodes the request. Domain rules live in `packages/engine`, and the ones the browser shares in `packages/contract/src/rules.ts`.
- **Use Effect's built-in modules where they exist**: `Schema`, `FileSystem`, `Path`, `effect/cli`, the `effect/ai` MCP server.

## Rules

| Rule                            | Summary                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema owns the shape           | Define data with `Schema.Struct` and derive the type with `typeof X.Type`. Don't keep a separate interface that can drift from the schema.                                                                                                                               |
| Parse at the boundary           | Decode external data (file frontmatter, `config.json`, request bodies, MCP arguments, CLI flags) with `Schema.decodeUnknownEffect`, or `decodeUnknownOption` when failure is an expected branch. Trust the type inside. See the **boundary-discipline** principle skill. |
| Typed errors                    | Failures a caller can handle are `Schema.TaggedError` classes (`TaskNotFound`, `InvalidRequest`, `StorageError`) in the error channel. Catch them by tag. Defects (`Effect.die`) are for bugs, not for expected failures.                                                |
| `Effect.fn` for service methods | Name them with `Effect.fn("Workspace.moveTask")` so traces and logs carry the name once tracing exists.                                                                                                                                                                  |
| Discriminated unions            | Model variants with a literal discriminant so impossible states can't be represented. No optional-field bags.                                                                                                                                                            |
| Branded types                   | Brand primitives that must not mix (a task id vs a list id) with `Schema.brand`, or `& { readonly __brand: "X" }` outside Schema. A brand comes from a decode or a verifying guard, never from `as`.                                                                     |
| Constructive modeling           | Build the shape so the illegal value can't be constructed. `[T, ...T[]]` for non-empty, `start` plus `duration` for a range.                                                                                                                                             |
| Simplest total type             | Keep `T[]` while every operation on it stays total. Strengthen it only where the loose type forces `!`, a cast, or a "should never happen" throw.                                                                                                                        |
| `unknown` over `any`            | External data is `unknown` until a schema decodes it.                                                                                                                                                                                                                    |
| No `as` casts                   | Every `as` is a runtime crash waiting. Cast only after validation.                                                                                                                                                                                                       |
| Narrowing hierarchy             | Discriminant switch > `in` operator > `typeof`/`instanceof` > user-defined type guard > `as`.                                                                                                                                                                            |
| Type guards                     | Must verify the claim. A lying guard is worse than `as`. Name them `isX` or `hasX`.                                                                                                                                                                                      |
| Exhaustiveness                  | `const _exhaustive: never = x;` in default arms, or `Match.exhaustive`, so a new variant fails the build.                                                                                                                                                                |
| `satisfies` over `as`           | Validates the value without widening literal types.                                                                                                                                                                                                                      |
| Schema-derived types            | Reach for `Pick`/`Omit`/`Parameters`/`ReturnType`/`typeof` and `Schema.pick`/`Schema.omit` before declaring a new type.                                                                                                                                                  |
| Object args                     | Pass objects, not positional arguments, so argument order is self-documenting. Skip on hot paths.                                                                                                                                                                        |
| Real tests                      | Don't mock what you can run. Engine tests run the real `Workspace` against a temp folder (`packages/engine/test/`). Mock only what you can't run locally.                                                                                                                |
| Structured logs                 | `Effect.logInfo`, `Effect.logWarning`, and `Effect.logDebug` inside Effect code, with the id that lets someone debug it. `console` only at a process entry point (`main.ts`), as the server and desktop do.                                                              |

Examples: `references/patterns.md`.
